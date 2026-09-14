/**
 * レシピ詳細画面の BB テスト（レイアウト・参照材料リンク・404・本人操作）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { RecipeDetailScreen } from "../RecipeDetailScreen";
import * as commentApi from "@/features/comment/api";
import type { Comment } from "@/features/comment/api";
import * as favoriteApi from "@/features/favorite/api";
import * as historyApi from "@/features/history/api";
import * as imageApi from "@/features/image/api";
import { pickImage } from "@/features/image/pickImage";
import * as recipeApi from "@/features/recipe/api";
import type { RecipeResponse } from "@/features/recipe/api";
import { ApiError } from "@/features/auth/api";
import { useSession } from "@/store/session";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ id: "r1" }),
}));

jest.mock("@/features/recipe/api", () => {
  const actual =
    jest.requireActual<typeof import("@/features/recipe/api")>("@/features/recipe/api");
  return { ...actual, getRecipe: jest.fn(), getUnits: jest.fn(), deleteRecipe: jest.fn() };
});

// 閲覧記録（Issue #42）。詳細を開くと fire-and-forget で呼ばれるので、
// 実通信させないようここでモックする。
jest.mock("@/features/history/api", () => {
  const actual =
    jest.requireActual<typeof import("@/features/history/api")>("@/features/history/api");
  return { ...actual, recordRecipeView: jest.fn() };
});

// お気に入り（Issue #100）。♡ ボタンの押下で呼ばれるので実通信させない。
jest.mock("@/features/favorite/api", () => ({
  favoriteRecipe: jest.fn(),
  unfavoriteRecipe: jest.fn(),
}));

// 感想（Issue #102）。詳細を開くと一覧を読みに行くので実通信させない。
jest.mock("@/features/comment/api", () => ({
  listComments: jest.fn(),
  createComment: jest.fn(),
  updateComment: jest.fn(),
  deleteComment: jest.fn(),
}));

// 感想の画像添付（端末の画像選択 → POST /images）。実機の選択画面と通信を使わない。
jest.mock("@/features/image/pickImage", () => ({ pickImage: jest.fn() }));
jest.mock("@/features/image/api", () => ({ uploadImage: jest.fn() }));

const mockPickImage = pickImage as jest.Mock;
const mockUploadImage = imageApi.uploadImage as jest.Mock;
const mockListComments = commentApi.listComments as jest.Mock;
const mockCreateComment = commentApi.createComment as jest.Mock;
const mockUpdateComment = commentApi.updateComment as jest.Mock;
const mockDeleteComment = commentApi.deleteComment as jest.Mock;

function makeComment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    body: `[E2E_TEST] 感想 ${id}`,
    imageUrl: null,
    author: { id: "viewer-1", displayName: "閲覧者", avatarUrl: null },
    createdAt: "2026-09-12T00:00:00Z",
    updatedAt: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

const mockGetRecipe = recipeApi.getRecipe as jest.Mock;
const mockFavoriteRecipe = favoriteApi.favoriteRecipe as jest.Mock;
const mockUnfavoriteRecipe = favoriteApi.unfavoriteRecipe as jest.Mock;
const mockRecordView = historyApi.recordRecipeView as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeRecipe(overrides: Partial<RecipeResponse> = {}): RecipeResponse {
  return {
    id: "r1",
    author: { id: "author-1", displayName: "投稿者太郎" },
    title: "肉じゃが",
    description: "定番の和食",
    servings: 3,
    isPublic: true,
    thumbnailUrl: null,
    thumbnailKey: null,
    isFavorited: false,
    favoriteCount: 0,
    commentCount: 0,
    createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z",
    ingredientGroups: [
      {
        name: null,
        ingredients: [
          { name: "じゃがいも", quantity: "3", unit: "個", placement: "suffix", refRecipe: null },
        ],
      },
    ],
    steps: [{ body: "切る", imageUrl: null, imageKey: null }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (recipeApi.getUnits as jest.Mock).mockResolvedValue({
    units: [
      { value: "個", placement: "suffix" },
      { value: "大さじ", placement: "prefix" },
    ],
  });
  /**
   * 認証必須の API は「セッション復元済み かつ ログイン済み」でのみ投げるように
   * なったので（Codex #42 指摘の対策）、テストでもログイン状態を用意する。
   */
  function signIn() {
    useSession.setState({
      hydrated: true,
      isAuthenticated: true,
      accessToken: "test-token",
      refreshToken: "test-refresh",
      // お気に入りの楽観更新は「操作したユーザー」が分かるときだけ書き換える。
      user: { id: "viewer-1", displayName: "閲覧者" },
    });
  }

  mockRecordView.mockResolvedValue(undefined);
  mockListComments.mockResolvedValue({ items: [], nextCursor: null });
  useSession.getState().clear();
  signIn();
});

describe("RecipeDetailScreen", () => {
  it("グループ名なしなら見出しを出さずフラットに材料を表示する", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByText, queryByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    expect(await findByText("肉じゃが")).toBeTruthy();
    expect(await findByText("じゃがいも")).toBeTruthy();
    expect(queryByTestId("detail-group-name-0")).toBeNull();
  });

  it("投稿者をタップするとその人のプロフィールへ（Issue #96）", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("recipe-detail-author"));
    expect(mockPush).toHaveBeenCalledWith("/home/users/author-1");
  });

  it("自分のレシピなら投稿者のタップでマイページへ", async () => {
    useSession.setState({ user: { id: "author-1", displayName: "投稿者太郎" } });
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("recipe-detail-author"));
    expect(mockNavigate).toHaveBeenCalledWith("/my-page");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("♡ ボタンにお気に入り数を出し、押すと返事を待たずにハートと数が変わる（Issue #100）", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ favoriteCount: 2 }));
    mockFavoriteRecipe.mockReturnValue(new Promise(() => undefined));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    const button = await findByTestId("recipe-detail-favorite");
    expect(getByTestId("recipe-detail-favorite-count").props.children).toBe(2);
    expect(button.props.accessibilityState.selected).toBe(false);

    await fireEvent.press(button);

    await waitFor(() => expect(getByTestId("recipe-detail-favorite-count").props.children).toBe(3));
    expect(getByTestId("recipe-detail-favorite").props.accessibilityState).toMatchObject({
      selected: true,
      // 送信中は二重に押せない。
      disabled: true,
    });
    expect(mockFavoriteRecipe).toHaveBeenCalledWith("r1");
  });

  it("お気に入り済みなら ♡ で解除の API を呼ぶ", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ isFavorited: true, favoriteCount: 1 }));
    mockUnfavoriteRecipe.mockReturnValue(new Promise(() => undefined));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    await fireEvent.press(await findByTestId("recipe-detail-favorite"));

    await waitFor(() => expect(getByTestId("recipe-detail-favorite-count").props.children).toBe(0));
    expect(mockUnfavoriteRecipe).toHaveBeenCalledWith("r1");
  });

  it("お気に入りに失敗したら、ハートと数を元に戻す", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ favoriteCount: 2 }));
    mockFavoriteRecipe.mockRejectedValue(new Error("network"));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    await fireEvent.press(await findByTestId("recipe-detail-favorite"));

    await waitFor(() =>
      expect(getByTestId("recipe-detail-favorite").props.accessibilityState.disabled).toBe(false),
    );
    expect(getByTestId("recipe-detail-favorite-count").props.children).toBe(2);
    expect(getByTestId("recipe-detail-favorite").props.accessibilityState.selected).toBe(false);
  });

  it("自分の非公開レシピにも ♡ を付けられる（favorite.md §3）", async () => {
    useSession.setState({ user: { id: "author-1", displayName: "投稿者太郎" } });
    mockGetRecipe.mockResolvedValue(makeRecipe({ isPublic: false }));
    mockFavoriteRecipe.mockReturnValue(new Promise(() => undefined));
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });

    await fireEvent.press(await findByTestId("recipe-detail-favorite"));

    expect(mockFavoriteRecipe).toHaveBeenCalledWith("r1");
  });

  it("グループ名ありなら見出しを出す", async () => {
    mockGetRecipe.mockResolvedValue(
      makeRecipe({
        ingredientGroups: [
          {
            name: "合わせ調味料",
            ingredients: [
              {
                name: "しょうゆ",
                quantity: "2",
                unit: "大さじ",
                placement: "prefix",
                refRecipe: null,
              },
            ],
          },
        ],
      }),
    );
    const { findByTestId, findByText } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    expect((await findByTestId("detail-group-name-0")).props.children).toBe("合わせ調味料");
    // prefix なので「大さじ 2」
    expect(await findByText("大さじ 2")).toBeTruthy();
  });

  it("参照材料（生存）はタップでそのレシピ詳細へ push する", async () => {
    mockGetRecipe.mockResolvedValue(
      makeRecipe({
        ingredientGroups: [
          {
            name: null,
            ingredients: [
              {
                name: "自家製だれ",
                quantity: null,
                unit: null,
                placement: "suffix",
                refRecipe: { id: "r2", title: "自家製だれ" },
              },
            ],
          },
        ],
      }),
    );
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("detail-ingredient-link-0-0"));
    expect(mockPush).toHaveBeenCalledWith("/home/recipes/r2");
  });

  it("参照先削除済み（refRecipe.id=null）はタップで「削除されました」を出す", async () => {
    mockGetRecipe.mockResolvedValue(
      makeRecipe({
        ingredientGroups: [
          {
            name: null,
            ingredients: [
              {
                name: "自家製だれ",
                quantity: null,
                unit: null,
                placement: "suffix",
                refRecipe: { id: null, title: "自家製だれ" },
              },
            ],
          },
        ],
      }),
    );
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("detail-ingredient-link-0-0"));
    expect(await findByTestId("recipe-dead-ref-dialog")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("本人なら編集・削除ボタンが出る", async () => {
    useSession.setState({ user: { id: "author-1", displayName: "投稿者太郎" } });
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    expect(await findByTestId("recipe-detail-edit")).toBeTruthy();
    expect(await findByTestId("recipe-detail-delete")).toBeTruthy();
  });

  it("他人のレシピには編集・削除ボタンを出さない", async () => {
    useSession.setState({ user: { id: "someone-else", displayName: "別の人" } });
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByText, queryByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByText("肉じゃが");
    expect(queryByTestId("recipe-detail-edit")).toBeNull();
  });

  it("404 は「表示できません」を出す", async () => {
    mockGetRecipe.mockRejectedValue(new ApiError("レシピが見つかりません", "NOT_FOUND", 404));
    const { findByText } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    expect(await findByText("表示できません")).toBeTruthy();
  });

  // --- 閲覧記録（Issue #42 / features/view-history.md §3）-------------------

  it("取得に成功したら閲覧を 1 回だけ記録する", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByText } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    await findByText("肉じゃが");

    expect(mockRecordView).toHaveBeenCalledTimes(1);
    expect(mockRecordView).toHaveBeenCalledWith("r1");
  });

  it("再描画されても記録は増えない（描画ではなく取得成功を契機にする）", async () => {
    // 本人のレシピにして削除ダイアログを開けるようにし、再描画を起こす。
    useSession.setState({ user: { id: "author-1", displayName: "本人" } });
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByText, findByTestId, getByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      {
        wrapper,
      },
    );
    await findByText("肉じゃが");
    expect(mockRecordView).toHaveBeenCalledTimes(1);

    // ダイアログを開いて閉じる = state 更新による再描画を 2 回起こす。
    await fireEvent.press(await findByTestId("recipe-detail-delete"));
    await fireEvent.press(getByTestId("recipe-delete-dialog-cancel"));

    expect(mockRecordView).toHaveBeenCalledTimes(1);
  });

  it("記録に失敗しても詳細の表示は壊れない（fire-and-forget）", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    mockRecordView.mockRejectedValue(new ApiError("boom", "INTERNAL", 500));

    const { findByText } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    expect(await findByText("肉じゃが")).toBeTruthy();
  });

  it("セッション復元前は詳細取得も閲覧記録もしない（保存済みトークンを失わないため）", async () => {
    useSession.getState().clear();
    useSession.setState({ hydrated: false, isAuthenticated: false });
    mockGetRecipe.mockResolvedValue(makeRecipe());

    await render(<RecipeDetailScreen basePath="/home" />, { wrapper });

    expect(mockGetRecipe).not.toHaveBeenCalled();
    expect(mockRecordView).not.toHaveBeenCalled();
  });

  it("取得に失敗したときは記録しない（GET 成功が前提）", async () => {
    mockGetRecipe.mockRejectedValue(new ApiError("レシピが見つかりません", "NOT_FOUND", 404));
    const { findByText } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });
    await findByText("表示できません");

    expect(mockRecordView).not.toHaveBeenCalled();
  });
});

// --- 感想セクション（Issue #102 / features/comment.md）-------------------------

describe("RecipeDetailScreen の感想", () => {
  it("感想が無ければ空状態の文言と、見出しに数を出す", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 0 }));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    expect((await findByTestId("comment-empty")).props.children).toBe(
      "まだ感想がありません。作ってみたら感想を書いてみましょう",
    );
    expect(getByTestId("comment-heading").props.children).toEqual(["感想（", 0, "）"]);
    expect(mockListComments).toHaveBeenCalledWith("r1", { cursor: undefined, limit: 20 });
  });

  it("一覧を新しい順に出し、「もっと見る」で次のページを読む", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 3 }));
    mockListComments
      .mockResolvedValueOnce({ items: [makeComment("c3"), makeComment("c2")], nextCursor: "n1" })
      .mockResolvedValueOnce({ items: [makeComment("c1")], nextCursor: null });
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    expect(await findByTestId("comment-c3")).toBeTruthy();
    expect(getByTestId("comment-c2")).toBeTruthy();

    await fireEvent.press(getByTestId("comment-more"));

    expect(await findByTestId("comment-c1")).toBeTruthy();
    expect(mockListComments).toHaveBeenLastCalledWith("r1", { cursor: "n1", limit: 20 });
    // 最後のページまで読んだら「もっと見る」は消える。
    await waitFor(() => expect(queryByTestId("comment-more")).toBeNull());
  });

  it("続きの読み込みに失敗しても表示済みの感想を残し、再試行で次のページを読む", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 2 }));
    mockListComments
      .mockResolvedValueOnce({ items: [makeComment("c1")], nextCursor: "n1" })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ items: [makeComment("c2")], nextCursor: null });
    const { findByTestId, findByText, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    expect(await findByTestId("comment-c1")).toBeTruthy();
    await fireEvent.press(getByTestId("comment-more"));

    expect(getByTestId("comment-c1")).toBeTruthy();
    expect(await findByText("続きを読み込めませんでした")).toBeTruthy();
    expect(queryByTestId("comment-more")).toBeNull();

    await fireEvent.press(getByTestId("comment-more-retry"));

    expect(await findByTestId("comment-c2")).toBeTruthy();
    await waitFor(() => expect(queryByTestId("comment-more-retry")).toBeNull());
  });

  it("投稿のあとの取り直しに失敗しても一覧を残し、「続き」ではなく取り直しの再試行を出す（Issue #130）", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValueOnce({
      items: [makeComment("c1", { author: { id: "u2", displayName: "別の人", avatarUrl: null } })],
      nextCursor: null,
    });
    mockCreateComment.mockResolvedValue(makeComment("c2", { body: "おいしかった" }));
    const { findByTestId, findByText, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );
    await findByTestId("comment-c1");

    // 投稿のあとの取り直しだけ失敗させる（続きのページは無い）。
    mockListComments.mockRejectedValueOnce(new Error("network"));
    await fireEvent.changeText(getByTestId("comment-composer-input"), "おいしかった");
    await fireEvent.press(getByTestId("comment-composer-submit"));

    expect(await findByText("最新の感想を読み込めませんでした")).toBeTruthy();
    // 表示済みの感想は残し、「続き」の失敗としては扱わない。
    expect(getByTestId("comment-c1")).toBeTruthy();
    expect(getByTestId("comment-c2")).toBeTruthy();
    expect(queryByTestId("comment-more-retry")).toBeNull();

    // 再試行は取り直し（refetch）。成功すればエラー表示が消える。
    mockListComments.mockResolvedValueOnce({
      items: [
        makeComment("c2", { body: "おいしかった" }),
        makeComment("c1", { author: { id: "u2", displayName: "別の人", avatarUrl: null } }),
      ],
      nextCursor: null,
    });
    await fireEvent.press(getByTestId("comment-refresh-retry"));

    await waitFor(() => expect(queryByTestId("comment-refresh-retry")).toBeNull());
    expect(getByTestId("comment-c2")).toBeTruthy();
  });

  it("画面を末尾近くまでスクロールしても、次のページを読む", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    mockListComments
      .mockResolvedValueOnce({ items: [makeComment("c2")], nextCursor: "n1" })
      .mockResolvedValueOnce({ items: [makeComment("c1")], nextCursor: null });
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("comment-c2");

    await fireEvent.scroll(getByTestId("recipe-detail-scroll"), {
      nativeEvent: {
        layoutMeasurement: { height: 800 },
        contentOffset: { y: 1000 },
        contentSize: { height: 1900 },
      },
    });

    expect(await findByTestId("comment-c1")).toBeTruthy();
  });

  it("詳細の ScrollView はキーボード表示中も 1 回のタップを受け付ける", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });

    const scroll = await findByTestId("recipe-detail-scroll");
    expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
  });

  it("レシピ投稿者本人には入力欄を出さず、他人の感想には「削除」だけ出す", async () => {
    useSession.setState({ user: { id: "author-1", displayName: "投稿者太郎" } });
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    const { findByTestId, queryByTestId, getByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await findByTestId("comment-c1");
    expect(queryByTestId("comment-composer")).toBeNull();
    expect(getByTestId("comment-c1-delete")).toBeTruthy();
    expect(queryByTestId("comment-c1-edit")).toBeNull();
  });

  it("他人のレシピに本文だけの感想を投稿すると、先頭に出て入力が空に戻り、数が増える", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({
      items: [makeComment("c1", { author: { id: "u2", displayName: "別の人", avatarUrl: null } })],
      nextCursor: null,
    });
    mockCreateComment.mockResolvedValue(makeComment("c2", { body: "おいしかった" }));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("comment-c1");

    // 投稿のあとは一覧と詳細を取り直すので、本物のサーバーと同じく「投稿後の状態」を返す。
    mockListComments.mockResolvedValue({
      items: [
        makeComment("c2", { body: "おいしかった" }),
        makeComment("c1", { author: { id: "u2", displayName: "別の人", avatarUrl: null } }),
      ],
      nextCursor: null,
    });
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 2 }));
    await fireEvent.changeText(getByTestId("comment-composer-input"), "  おいしかった  ");
    await fireEvent.press(getByTestId("comment-composer-submit"));

    // 前後の空白を除いて送る。画像を選んでいなければ imageKey は null。
    expect(mockCreateComment).toHaveBeenCalledWith("r1", { body: "おいしかった", imageKey: null });
    expect(await findByTestId("comment-c2")).toBeTruthy();
    await waitFor(() => expect(getByTestId("comment-composer-input").props.value).toBe(""));
    expect(getByTestId("comment-heading").props.children).toEqual(["感想（", 2, "）"]);
  });

  it("新規投稿の送信中は本文・画像・送信を操作できない", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    let resolveCreate!: (comment: Comment) => void;
    mockCreateComment.mockReturnValue(
      new Promise<Comment>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("comment-empty");

    await fireEvent.changeText(getByTestId("comment-composer-input"), "送信中の感想");
    await act(async () => {
      void fireEvent.press(getByTestId("comment-composer-submit"));
    });

    await waitFor(() => expect(getByTestId("comment-composer-input").props.editable).toBe(false));
    expect(getByTestId("comment-composer-image-pick").props.accessibilityState?.disabled).toBe(
      true,
    );
    expect(getByTestId("comment-composer-submit").props.accessibilityState?.disabled).toBe(true);

    await act(async () => {
      resolveCreate(makeComment("c1"));
    });
    await waitFor(() => expect(getByTestId("comment-composer-input").props.editable).toBe(true));
  });

  it("画像を添付すると、アップロードで受け取ったキーを付けて投稿する", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    mockPickImage.mockResolvedValue({ uri: "file://a", file: new Blob(["x"]) });
    mockUploadImage.mockResolvedValue({
      key: "uploads/comment.jpg",
      url: "https://example.com/comment.jpg",
    });
    mockCreateComment.mockResolvedValue(
      makeComment("c1", { imageUrl: "https://example.com/comment.jpg" }),
    );
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("comment-empty");

    await fireEvent.press(getByTestId("comment-composer-image-pick"));
    expect(await findByTestId("comment-composer-image-preview")).toBeTruthy();
    await fireEvent.changeText(getByTestId("comment-composer-input"), "写真つき");
    await fireEvent.press(getByTestId("comment-composer-submit"));

    expect(mockCreateComment).toHaveBeenCalledWith("r1", {
      body: "写真つき",
      imageKey: "uploads/comment.jpg",
    });
  });

  it("本文が空、または 1000 文字を超えると送信できない", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("comment-empty");

    await fireEvent.changeText(getByTestId("comment-composer-input"), "   ");
    expect(getByTestId("comment-composer-submit").props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(getByTestId("comment-composer-input"), "あ".repeat(1001));
    expect(getByTestId("comment-composer-submit").props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(getByTestId("comment-composer-input"), "あ".repeat(1000));
    expect(getByTestId("comment-composer-submit").props.accessibilityState.disabled).toBe(false);

    // JavaScript の length では絵文字を 2 文字として数えるが、サーバーはコードポイントで数える。
    const emojiBody = "😀".repeat(1000);
    mockCreateComment.mockResolvedValue(makeComment("c1", { body: emojiBody }));
    await fireEvent.changeText(getByTestId("comment-composer-input"), emojiBody);
    expect(getByTestId("comment-composer-count").props.children).toEqual([1000, " / ", 1000]);
    expect(getByTestId("comment-composer-submit").props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(getByTestId("comment-composer-submit"));
    expect(mockCreateComment).toHaveBeenCalledWith("r1", { body: emojiBody, imageKey: null });
  });

  it("投稿に失敗したら、サーバーのメッセージを出して入力は残す", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    mockCreateComment.mockRejectedValue(
      new ApiError("自分のレシピには感想を書けません", "FORBIDDEN", 403),
    );
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("comment-empty");

    await fireEvent.changeText(getByTestId("comment-composer-input"), "おいしい");
    await fireEvent.press(getByTestId("comment-composer-submit"));

    expect((await findByTestId("comment-composer-error")).props.children).toBe(
      "自分のレシピには感想を書けません",
    );
    expect(getByTestId("comment-composer-input").props.value).toBe("おいしい");
  });

  it("自分の感想の本文を編集すると、画像は触らないので imageKey を送らない", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    mockUpdateComment.mockResolvedValue(makeComment("c1", { body: "直した" }));
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await fireEvent.press(await findByTestId("comment-c1-edit"));
    // 保存のあとの取り直しでは、編集後の本文を返す。
    mockListComments.mockResolvedValue({
      items: [makeComment("c1", { body: "直した" })],
      nextCursor: null,
    });
    await fireEvent.changeText(getByTestId("comment-c1-editor-input"), "直した");
    await fireEvent.press(getByTestId("comment-c1-editor-submit"));

    expect(mockUpdateComment).toHaveBeenCalledWith("c1", { body: "直した" });
    await waitFor(() => expect(queryByTestId("comment-c1-editor")).toBeNull());
    expect(getByTestId("comment-c1-body").props.children).toBe("直した");
  });

  it("感想の保存中は本文とキャンセルを操作できない", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    let resolveUpdate!: (comment: Comment) => void;
    mockUpdateComment.mockReturnValue(
      new Promise<Comment>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await fireEvent.press(await findByTestId("comment-c1-edit"));
    await fireEvent.changeText(getByTestId("comment-c1-editor-input"), "保存中の感想");
    await act(async () => {
      void fireEvent.press(getByTestId("comment-c1-editor-submit"));
    });

    await waitFor(() => expect(getByTestId("comment-c1-editor-input").props.editable).toBe(false));
    expect(getByTestId("comment-c1-editor-cancel").props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(getByTestId("comment-c1-editor-cancel"));
    expect(queryByTestId("comment-c1-editor")).toBeTruthy();

    await act(async () => {
      resolveUpdate(makeComment("c1", { body: "保存中の感想" }));
    });
    await waitFor(() => expect(queryByTestId("comment-c1-editor")).toBeNull());
  });

  it("複数の感想を続けて保存しても、保存中の行だけ操作できない", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 2 }));
    mockListComments.mockResolvedValue({
      items: [makeComment("c1"), makeComment("c2")],
      nextCursor: null,
    });
    let resolveC1!: (comment: Comment) => void;
    let resolveC2!: (comment: Comment) => void;
    mockUpdateComment.mockImplementation((commentId: string) => {
      return new Promise<Comment>((resolve) => {
        if (commentId === "c1") resolveC1 = resolve;
        else resolveC2 = resolve;
      });
    });
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await fireEvent.press(await findByTestId("comment-c1-edit"));
    await fireEvent.press(getByTestId("comment-c2-edit"));
    await fireEvent.changeText(getByTestId("comment-c1-editor-input"), "c1 保存中");
    await fireEvent.changeText(getByTestId("comment-c2-editor-input"), "c2 保存中");
    await act(async () => {
      void fireEvent.press(getByTestId("comment-c1-editor-submit"));
    });
    await waitFor(() =>
      expect(mockUpdateComment).toHaveBeenCalledWith("c1", { body: "c1 保存中" }),
    );
    await act(async () => {
      void fireEvent.press(getByTestId("comment-c2-editor-submit"));
    });
    await waitFor(() =>
      expect(mockUpdateComment).toHaveBeenCalledWith("c2", { body: "c2 保存中" }),
    );

    await waitFor(() => {
      expect(getByTestId("comment-c1-editor-input").props.editable).toBe(false);
      expect(getByTestId("comment-c2-editor-input").props.editable).toBe(false);
    });

    await act(async () => {
      resolveC2(makeComment("c2", { body: "c2 保存中" }));
    });
    await waitFor(() => expect(queryByTestId("comment-c2-editor")).toBeNull());

    expect(getByTestId("comment-c1-editor-input").props.editable).toBe(false);
    expect(getByTestId("comment-c1-editor-cancel").props.accessibilityState?.disabled).toBe(true);

    await act(async () => {
      resolveC1(makeComment("c1", { body: "c1 保存中" }));
    });
    await waitFor(() => expect(queryByTestId("comment-c1-editor")).toBeNull());
  });

  it("編集で画像を外すと imageKey: null を送る", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({
      items: [makeComment("c1", { imageUrl: "https://example.com/c1.jpg" })],
      nextCursor: null,
    });
    mockUpdateComment.mockResolvedValue(makeComment("c1"));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    expect(await findByTestId("comment-c1-image")).toBeTruthy();
    await fireEvent.press(getByTestId("comment-c1-edit"));
    await fireEvent.press(getByTestId("comment-c1-editor-image-remove"));
    await fireEvent.press(getByTestId("comment-c1-editor-submit"));

    expect(mockUpdateComment).toHaveBeenCalledWith("c1", {
      body: "[E2E_TEST] 感想 c1",
      imageKey: null,
    });
  });

  it("編集をキャンセルすると元の表示に戻り、API は呼ばない", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await fireEvent.press(await findByTestId("comment-c1-edit"));
    await fireEvent.press(getByTestId("comment-c1-editor-cancel"));

    expect(queryByTestId("comment-c1-editor")).toBeNull();
    expect(mockUpdateComment).not.toHaveBeenCalled();
  });

  it("自分の感想を確認ダイアログから削除すると、一覧から消えて数が減る", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    mockDeleteComment.mockResolvedValue(undefined);
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await fireEvent.press(await findByTestId("comment-c1-delete"));
    // 取り直しの一覧と詳細は、消えたあとの状態を返す。
    mockListComments.mockResolvedValue({ items: [], nextCursor: null });
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 0 }));
    await fireEvent.press(getByTestId("comment-delete-dialog-confirm"));

    expect(mockDeleteComment).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(queryByTestId("comment-c1")).toBeNull());
    expect(getByTestId("comment-heading").props.children).toEqual(["感想（", 0, "）"]);
  });

  it("最後の感想を削除したあとの取り直しに失敗しても、空状態より再試行を優先する（Issue #130）", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments
      .mockResolvedValueOnce({ items: [makeComment("c1")], nextCursor: null })
      // 削除後の取り直しは失敗するが、再試行では空の一覧を返す。
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    mockDeleteComment.mockResolvedValue(undefined);
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <RecipeDetailScreen basePath="/home" />,
      { wrapper },
    );

    await fireEvent.press(await findByTestId("comment-c1-delete"));
    await fireEvent.press(getByTestId("comment-delete-dialog-confirm"));

    expect(await findByTestId("comment-refresh-retry")).toBeTruthy();
    expect(queryByTestId("comment-empty")).toBeNull();

    await fireEvent.press(getByTestId("comment-refresh-retry"));

    expect(await findByTestId("comment-empty")).toBeTruthy();
    expect(queryByTestId("comment-refresh-retry")).toBeNull();
  });

  it("削除に失敗したらエラーを出す", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    mockDeleteComment.mockRejectedValue(new Error(""));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    await fireEvent.press(await findByTestId("comment-c1-delete"));
    await fireEvent.press(getByTestId("comment-delete-dialog-confirm"));

    expect((await findByTestId("comment-delete-error")).props.children).toBe(
      "感想を削除できませんでした",
    );
  });

  it("削除の通信中はその感想の「削除」「編集」を押せず、DELETE を二重に送らない（Issue #130）", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    // 返事が来ないまま（通信が遅い状態）にする。
    mockDeleteComment.mockReturnValue(new Promise(() => undefined));
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    await fireEvent.press(await findByTestId("comment-c1-delete"));
    await fireEvent.press(getByTestId("comment-delete-dialog-confirm"));

    await waitFor(() =>
      expect(getByTestId("comment-c1-delete").props.accessibilityState.disabled).toBe(true),
    );
    expect(getByTestId("comment-c1-edit").props.accessibilityState.disabled).toBe(true);

    // もう一度「削除」を押しても、2 回目の DELETE は送られない。
    await fireEvent.press(getByTestId("comment-c1-delete"));
    expect(mockDeleteComment).toHaveBeenCalledTimes(1);
  });

  it("ユーザー情報が無いと入力欄・編集・削除を出さず、ログイン案内を出す", async () => {
    useSession.setState({
      user: null,
      isAuthenticated: true,
      accessToken: "restored-token",
      refreshToken: "restored-refresh",
    });
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 1 }));
    mockListComments.mockResolvedValue({ items: [makeComment("c1")], nextCursor: null });
    const { findByTestId, queryByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    expect((await findByTestId("comment-need-login")).props.children).toBe(
      "ログインし直すと感想を書けます",
    );
    expect(queryByTestId("comment-composer")).toBeNull();
    expect(queryByTestId("comment-c1-edit")).toBeNull();
    expect(queryByTestId("comment-c1-delete")).toBeNull();
  });

  it("感想の投稿者をタップすると、他人ならプロフィール、自分ならマイページへ", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe({ commentCount: 2 }));
    mockListComments.mockResolvedValue({
      items: [
        makeComment("c2", { author: { id: "u2", displayName: "別の人", avatarUrl: null } }),
        makeComment("c1"),
      ],
      nextCursor: null,
    });
    const { findByTestId, getByTestId } = await render(<RecipeDetailScreen basePath="/home" />, {
      wrapper,
    });

    await fireEvent.press(await findByTestId("comment-c2-author"));
    expect(mockPush).toHaveBeenCalledWith("/home/users/u2");

    await fireEvent.press(getByTestId("comment-c1-author"));
    expect(mockNavigate).toHaveBeenCalledWith("/my-page");
  });

  it("一覧の読み込みに失敗したら再試行できる", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    mockListComments
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ items: [makeComment("c1")], nextCursor: null });
    const { findByTestId } = await render(<RecipeDetailScreen basePath="/home" />, { wrapper });

    await fireEvent.press(await findByTestId("comment-retry"));

    expect(await findByTestId("comment-c1")).toBeTruthy();
  });
});
