/**
 * RecipeEditor の BB テスト（行編集 UX・保存・破棄ガード）。
 * API 層はモックする。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as ImagePicker from "expo-image-picker";

import * as recipeApi from "../api";
import { ApiError } from "@/features/auth/api";
import * as imageApi from "@/features/image/api";
import { RecipeEditor } from "../RecipeEditor";

const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    dismissTo: mockDismissTo,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  Stack: { Screen: () => null },
}));

jest.mock("../api", () => {
  const actual = jest.requireActual<typeof import("../api")>("../api");
  return {
    ...actual,
    getUnits: jest.fn(),
    listMyRecipes: jest.fn(),
    createRecipe: jest.fn(),
    updateRecipe: jest.fn(),
  };
});

jest.mock("@/features/image/api", () => ({ uploadImage: jest.fn() }));

const mockGetUnits = recipeApi.getUnits as jest.Mock;
const mockCreateRecipe = recipeApi.createRecipe as jest.Mock;
const mockUploadImage = imageApi.uploadImage as jest.Mock;
const mockLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  mockGetUnits.mockResolvedValue({
    units: [
      { value: "g", placement: "suffix" },
      { value: "大さじ", placement: "prefix" },
      { value: "少々", placement: "suffix" },
    ],
  });
  (recipeApi.listMyRecipes as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
  mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
});

async function fillMinimalRecipe(getByTestId: (id: string) => { props: unknown }) {
  await fireEvent.changeText(getByTestId("editor-title") as never, "肉じゃが");
  await fireEvent.changeText(getByTestId("g0-i0-name") as never, "じゃがいも");
  await fireEvent.changeText(getByTestId("step-0-body") as never, "切って煮る");
}

describe("RecipeEditor（作成）", () => {
  it("初期状態は名前なしグループ 1 つ ＋ 空材料行 1 つ", async () => {
    const { getByTestId, queryByTestId } = await render(<RecipeEditor mode="create" />, {
      wrapper,
    });
    expect(getByTestId("g0-i0-name")).toBeTruthy();
    expect(queryByTestId("g0-i1-name")).toBeNull();
  });

  it("「＋ 材料を追加」で行が増える", async () => {
    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, {
      wrapper,
    });
    await fireEvent.press(getByTestId("group-0-add-ingredient"));
    expect(await findByTestId("g0-i1-name")).toBeTruthy();
  });

  it("材料行を削除すると番号が詰まる", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await fireEvent.press(getByTestId("group-0-add-ingredient"));
    await fireEvent.press(getByTestId("group-0-add-ingredient"));
    await findByTestId("g0-i2-name");
    await fireEvent.changeText(getByTestId("g0-i2-name"), "最後の材料");
    await fireEvent.press(getByTestId("g0-i0-remove"));
    await waitFor(() => expect(queryByTestId("g0-i2-name")).toBeNull());
    // 詰まった結果、元の i2 が i1 になっている
    expect((getByTestId("g0-i1-name").props as { value: string }).value).toBe("最後の材料");
  });

  it("手順を並べ替えると順序が入れ替わる", async () => {
    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, {
      wrapper,
    });
    await fireEvent.changeText(getByTestId("step-0-body"), "A");
    await fireEvent.press(getByTestId("editor-add-step"));
    await findByTestId("step-1-body");
    await fireEvent.changeText(getByTestId("step-1-body"), "B");
    await fireEvent.press(getByTestId("step-1-move-up"));
    await waitFor(() =>
      expect((getByTestId("step-0-body").props as { value: string }).value).toBe("B"),
    );
  });

  it("▼ で候補一覧を開閉でき、選ぶと単位欄に入ってプレビューに反映される", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await fireEvent.changeText(getByTestId("g0-i0-name"), "しょうゆ");
    await fireEvent.changeText(getByTestId("g0-i0-quantity"), "2");

    // 入力欄には触れずに ▼ だけで開ける（スマホでキーボードを出さずに選べる）。
    expect(queryByTestId("g0-i0-unit-list")).toBeNull();
    await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressIn");
    expect(await findByTestId("g0-i0-unit-list")).toBeTruthy();

    // もう一度押すと閉じる（トグル）。
    await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressIn");
    expect(queryByTestId("g0-i0-unit-list")).toBeNull();

    // 開いて候補を選ぶと値が入り、一覧は閉じる。
    await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressIn");
    await fireEvent(await findByTestId("g0-i0-unit-option-大さじ"), "pressIn");
    expect(getByTestId("g0-i0-unit").props.value).toBe("大さじ");
    expect(queryByTestId("g0-i0-unit-list")).toBeNull();
    await waitFor(() =>
      expect(
        (getByTestId("g0-i0-preview").props as { children: unknown[] }).children.join(""),
      ).toContain("大さじ 2"),
    );
  });

  // react-native-web の responder は `blur` を capture phase で拾って進行中の
  // 押下を打ち切る（ResponderSystem.js）。そのため入力欄にフォーカスがある状態で
  // ▼ を押すと `onPress` は届かない。`onPressIn` は mousedown の時点で走るので
  // blur より先に発火する、という前提を守る。
  it("入力欄にフォーカスがある状態で ▼ を押しても開閉できる", async () => {
    const { getByTestId, queryByTestId, findByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );

    await fireEvent(getByTestId("g0-i0-unit"), "focus");
    expect(await findByTestId("g0-i0-unit-list")).toBeTruthy();

    // 実ブラウザでは pressIn の直後に入力欄の blur が入る。
    await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressIn");
    await fireEvent(getByTestId("g0-i0-unit"), "blur");

    // blur では閉じず、pressIn の反転だけが効く（開 → 閉）。
    expect(queryByTestId("g0-i0-unit-list")).toBeNull();
  });

  it("▼ の pressIn → pressOut → press でも候補一覧を 1 回だけ反転する", async () => {
    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, { wrapper });

    jest.useFakeTimers();
    try {
      await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressIn");
      // 押している時間の長さではなく、pressOut が来たかどうかだけで同じ操作と判定する。
      jest.advanceTimersByTime(5_000);
      await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressOut");
      await fireEvent(getByTestId("g0-i0-unit-toggle"), "press");

      // 2 回反転していれば閉じてしまうため、開いたままなら 1 回だけ反転できている。
      expect(await findByTestId("g0-i0-unit-list")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("press だけでも単位候補を開閉できる", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );

    await fireEvent(getByTestId("g0-i0-unit-toggle"), "press");
    expect(await findByTestId("g0-i0-unit-list")).toBeTruthy();

    await fireEvent(getByTestId("g0-i0-unit-toggle"), "press");
    expect(queryByTestId("g0-i0-unit-list")).toBeNull();
  });

  it("pressIn の後に press が来なくても、次の press は新しい操作として扱う", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );

    // blur などで press が届かず、pressIn の記録だけが残った状況を再現する。
    await fireEvent(getByTestId("g0-i0-unit-toggle"), "pressIn");
    expect(await findByTestId("g0-i0-unit-list")).toBeTruthy();

    // pressOut も press も来なかった後の、キーボード操作相当の press として閉じる。
    await fireEvent(getByTestId("g0-i0-unit-toggle"), "press");
    expect(queryByTestId("g0-i0-unit-list")).toBeNull();
  });

  it("候補を押した直後に入力欄の blur が来ても、単位が入る", async () => {
    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, { wrapper });
    await fireEvent(getByTestId("g0-i0-unit"), "focus");

    await fireEvent(await findByTestId("g0-i0-unit-option-大さじ"), "pressIn");
    await fireEvent(getByTestId("g0-i0-unit"), "blur");

    expect(getByTestId("g0-i0-unit").props.value).toBe("大さじ");
  });

  it("入力すると候補が前方一致で絞り込まれる", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await fireEvent.changeText(getByTestId("g0-i0-unit"), "大");

    expect(await findByTestId("g0-i0-unit-option-大さじ")).toBeTruthy();
    expect(queryByTestId("g0-i0-unit-option-g")).toBeNull();
  });

  it("候補に無い単位は自由入力できる（features/unit.md §2）", async () => {
    const { getByTestId } = await render(<RecipeEditor mode="create" />, { wrapper });
    await fireEvent.changeText(getByTestId("g0-i0-unit"), "つまみ");
    expect(getByTestId("g0-i0-unit").props.value).toBe("つまみ");
  });

  it("保存すると createRecipe が正規化済み body で呼ばれ、詳細へ遷移する", async () => {
    mockCreateRecipe.mockResolvedValue({ id: "r-new" });
    const { getByTestId } = await render(<RecipeEditor mode="create" />, { wrapper });
    await fillMinimalRecipe(getByTestId);
    await fireEvent.press(getByTestId("editor-save"));

    await waitFor(() => expect(mockCreateRecipe).toHaveBeenCalled());
    const body = mockCreateRecipe.mock.calls[0][0];
    expect(body.title).toBe("肉じゃが");
    expect(body.ingredientGroups).toEqual([
      {
        name: null,
        ingredients: [{ name: "じゃがいも", quantity: null, unit: null, refRecipeId: null }],
      },
    ]);
    expect(body.steps).toEqual([{ body: "切って煮る" }]);
    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith("/(app)/recipes/r-new"));
  });

  it("画像のアップロード中は保存できず、完了すると保存できる", async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/editor.jpg", width: 800, height: 600 }],
    });
    let resolveUpload!: (value: { key: string; url: string }) => void;
    mockUploadImage.mockReturnValue(
      new Promise<{ key: string; url: string }>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const { getByTestId, findByText, queryByTestId } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await act(async () => {
      void fireEvent.press(getByTestId("editor-thumbnail-pick"));
    });

    await waitFor(() => expect(getByTestId("editor-thumbnail-spinner")).toBeTruthy());
    expect(getByTestId("editor-save").props.accessibilityState?.disabled).toBe(true);
    expect(await findByText("画像のアップロード中です")).toBeTruthy();

    await act(async () => {
      resolveUpload({ key: "uploads/editor.jpg", url: "https://x/editor.jpg" });
    });
    await waitFor(() => expect(queryByTestId("editor-thumbnail-spinner")).toBeNull());
    expect(getByTestId("editor-save").props.accessibilityState?.disabled).toBeFalsy();
  });

  it("画像のアップロード中に「×」を押すと破棄確認ダイアログが出る", async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/editor.jpg", width: 800, height: 600 }],
    });
    let resolveUpload!: (value: { key: string; url: string }) => void;
    mockUploadImage.mockReturnValue(
      new Promise<{ key: string; url: string }>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, { wrapper });
    await act(async () => {
      void fireEvent.press(getByTestId("editor-thumbnail-pick"));
    });
    await waitFor(() => expect(getByTestId("editor-thumbnail-spinner")).toBeTruthy());

    await fireEvent.press(getByTestId("editor-close"));
    expect(await findByTestId("editor-discard-dialog")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("editor-discard-dialog-cancel"));
    await act(async () => {
      resolveUpload({ key: "uploads/editor.jpg", url: "https://x/editor.jpg" });
    });
  });

  it("必須未入力だと保存をブロックし、エラーをポップアップでも知らせる", async () => {
    const { getByTestId, findByTestId, getAllByText } = await render(
      <RecipeEditor mode="create" />,
      {
        wrapper,
      },
    );
    await fireEvent.press(getByTestId("editor-save"));

    // 保存ボタンは固定ヘッダーにあり、下までスクロールした状態でも押せる。
    // インライン表示だけだとエラーが画面外になりうるので、ポップアップも出す（#63）。
    expect(await findByTestId("editor-error-dialog")).toBeTruthy();
    // 欄の直下とポップアップの両方に出る。
    expect(getAllByText("タイトルを入力してください").length).toBeGreaterThanOrEqual(2);
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it("エラーのポップアップは「閉じる」で消える（インライン表示は残る）", async () => {
    const { getByTestId, findByTestId, queryByTestId, getAllByText } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await fireEvent.press(getByTestId("editor-save"));
    await findByTestId("editor-error-dialog");

    await fireEvent.press(getByTestId("editor-error-dialog-close"));

    await waitFor(() => expect(queryByTestId("editor-error-dialog")).toBeNull());
    // 閉じたあとも欄の下の手掛かりは残す。
    expect(getAllByText("タイトルを入力してください").length).toBeGreaterThanOrEqual(1);
  });

  it("欄に紐づかない失敗もポップアップで知らせる", async () => {
    mockCreateRecipe.mockRejectedValue(new Error("network down"));
    const { getByTestId, findByTestId, queryByTestId, getAllByText } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await fillMinimalRecipe(getByTestId);
    await fireEvent.press(getByTestId("editor-save"));

    expect(await findByTestId("editor-error-dialog")).toBeTruthy();
    expect(getAllByText("保存に失敗しました").length).toBeGreaterThanOrEqual(1);
    // 欄が特定できない失敗なので「最初のエラーへ移動」は出さない。
    expect(queryByTestId("editor-error-dialog-jump")).toBeNull();
  });

  it("サーバー 400 を受けるとエラー表示する", async () => {
    mockCreateRecipe.mockRejectedValue(
      new ApiError("リクエストの内容が不正です", "VALIDATION_ERROR", 400, {
        errors: [{ loc: ["body", "title"], msg: "too long", type: "value_error" }],
      }),
    );
    const { getByTestId, findByText, findByTestId, getAllByText } = await render(
      <RecipeEditor mode="create" />,
      { wrapper },
    );
    await fillMinimalRecipe(getByTestId);
    await fireEvent.press(getByTestId("editor-save"));
    expect(await findByText("入力内容を確認してください")).toBeTruthy();
    // サーバー 400 もクライアント検証と同じ形に翻訳されるので、同じポップアップに載る。
    expect(await findByTestId("editor-error-dialog")).toBeTruthy();
    expect(getAllByText("too long").length).toBeGreaterThanOrEqual(2);
  });

  it("未入力のまま「×」なら確認なしで閉じる", async () => {
    const { getByTestId } = await render(<RecipeEditor mode="create" />, { wrapper });
    await fireEvent.press(getByTestId("editor-close"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("編集モードの保存成功はモーダルを閉じるだけ（詳細を二重に積まない）", async () => {
    (recipeApi.updateRecipe as jest.Mock).mockResolvedValue({ id: "r1" });
    const recipe = {
      id: "r1",
      author: { id: "me", displayName: "私" },
      title: "肉じゃが",
      description: "",
      servings: 2,
      isPublic: false,
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
            { name: "芋", quantity: "1", unit: "個", placement: "suffix", refRecipe: null },
          ],
        },
      ],
      steps: [{ body: "煮る", imageUrl: null, imageKey: null }],
    };
    const { getByTestId } = await render(<RecipeEditor mode="edit" recipe={recipe} />, {
      wrapper,
    });
    await fireEvent.changeText(getByTestId("editor-title"), "肉じゃが改");
    await fireEvent.press(getByTestId("editor-save"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("戻り先が無い（編集 URL を直接開いた）ときは保存成功で詳細へ replace する", async () => {
    mockCanGoBack.mockReturnValue(false);
    (recipeApi.updateRecipe as jest.Mock).mockResolvedValue({ id: "r1" });
    const recipe = {
      id: "r1",
      author: { id: "me", displayName: "私" },
      title: "肉じゃが",
      description: "",
      servings: 2,
      isPublic: false,
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
            { name: "芋", quantity: "1", unit: "個", placement: "suffix", refRecipe: null },
          ],
        },
      ],
      steps: [{ body: "煮る", imageUrl: null, imageKey: null }],
    };
    const { getByTestId } = await render(<RecipeEditor mode="edit" recipe={recipe} />, {
      wrapper,
    });
    await fireEvent.changeText(getByTestId("editor-title"), "肉じゃが改");
    await fireEvent.press(getByTestId("editor-save"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(app)/recipes/r1"));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("変更後に「×」を押すと破棄確認ダイアログが出る", async () => {
    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, {
      wrapper,
    });
    await fireEvent.changeText(getByTestId("editor-title"), "変更");
    await fireEvent.press(getByTestId("editor-close"));
    expect(await findByTestId("editor-discard-dialog")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("editor-discard-dialog-confirm"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});
