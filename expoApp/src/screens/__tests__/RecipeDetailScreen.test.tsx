/**
 * レシピ詳細画面の BB テスト（レイアウト・参照材料リンク・404・本人操作）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { RecipeDetailScreen } from "../RecipeDetailScreen";
import * as historyApi from "@/features/history/api";
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

const mockGetRecipe = recipeApi.getRecipe as jest.Mock;
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
    });
  }

  mockRecordView.mockResolvedValue(undefined);
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
