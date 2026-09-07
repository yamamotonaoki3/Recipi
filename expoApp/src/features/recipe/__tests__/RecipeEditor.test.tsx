/**
 * RecipeEditor の BB テスト（行編集 UX・保存・破棄ガード）。
 * API 層はモックする。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import * as recipeApi from "../api";
import { ApiError } from "@/features/auth/api";
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

const mockGetUnits = recipeApi.getUnits as jest.Mock;
const mockCreateRecipe = recipeApi.createRecipe as jest.Mock;

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

  it("単位を選ぶとプレビューが単位ルールどおりに出る", async () => {
    const { getByTestId, findByTestId } = await render(<RecipeEditor mode="create" />, {
      wrapper,
    });
    await fireEvent.changeText(getByTestId("g0-i0-name"), "しょうゆ");
    await fireEvent.changeText(getByTestId("g0-i0-quantity"), "2");
    await fireEvent(getByTestId("g0-i0-unit"), "focus");
    await fireEvent.press(await findByTestId("g0-i0-unit-option-大さじ"));
    await waitFor(() =>
      expect(
        (getByTestId("g0-i0-preview").props as { children: unknown[] }).children.join(""),
      ).toContain("大さじ 2"),
    );
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

  it("必須未入力だと保存をブロックする", async () => {
    const { getByTestId, findByText } = await render(<RecipeEditor mode="create" />, { wrapper });
    await fireEvent.press(getByTestId("editor-save"));
    expect(await findByText("タイトルを入力してください")).toBeTruthy();
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it("サーバー 400 を受けるとエラー表示する", async () => {
    mockCreateRecipe.mockRejectedValue(
      new ApiError("リクエストの内容が不正です", "VALIDATION_ERROR", 400, {
        errors: [{ loc: ["body", "title"], msg: "too long", type: "value_error" }],
      }),
    );
    const { getByTestId, findByText } = await render(<RecipeEditor mode="create" />, { wrapper });
    await fillMinimalRecipe(getByTestId);
    await fireEvent.press(getByTestId("editor-save"));
    expect(await findByText("入力内容を確認してください")).toBeTruthy();
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
