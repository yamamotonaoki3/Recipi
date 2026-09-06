/**
 * レシピ詳細画面の BB テスト（レイアウト・参照材料リンク・404・本人操作）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import RecipeDetailScreen from "../[id]";
import * as recipeApi from "@/features/recipe/api";
import type { RecipeResponse } from "@/features/recipe/api";
import { ApiError } from "@/features/auth/api";
import { useSession } from "@/store/session";

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: "r1" }),
}));

jest.mock("@/features/recipe/api", () => {
  const actual =
    jest.requireActual<typeof import("@/features/recipe/api")>("@/features/recipe/api");
  return { ...actual, getRecipe: jest.fn(), getUnits: jest.fn(), deleteRecipe: jest.fn() };
});

const mockGetRecipe = recipeApi.getRecipe as jest.Mock;

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
  useSession.getState().clear();
});

describe("RecipeDetailScreen", () => {
  it("グループ名なしなら見出しを出さずフラットに材料を表示する", async () => {
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByText, queryByTestId } = await render(<RecipeDetailScreen />, { wrapper });
    expect(await findByText("肉じゃが")).toBeTruthy();
    expect(await findByText("じゃがいも")).toBeTruthy();
    expect(queryByTestId("detail-group-name-0")).toBeNull();
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
    const { findByTestId, findByText } = await render(<RecipeDetailScreen />, { wrapper });
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
    const { findByTestId } = await render(<RecipeDetailScreen />, { wrapper });
    await fireEvent.press(await findByTestId("detail-ingredient-link-0-0"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/recipes/r2");
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
    const { findByTestId } = await render(<RecipeDetailScreen />, { wrapper });
    await fireEvent.press(await findByTestId("detail-ingredient-link-0-0"));
    expect(await findByTestId("recipe-dead-ref-dialog")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("本人なら編集・削除ボタンが出る", async () => {
    useSession.setState({ user: { id: "author-1", displayName: "投稿者太郎" } });
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByTestId } = await render(<RecipeDetailScreen />, { wrapper });
    expect(await findByTestId("recipe-detail-edit")).toBeTruthy();
    expect(await findByTestId("recipe-detail-delete")).toBeTruthy();
  });

  it("他人のレシピには編集・削除ボタンを出さない", async () => {
    useSession.setState({ user: { id: "someone-else", displayName: "別の人" } });
    mockGetRecipe.mockResolvedValue(makeRecipe());
    const { findByText, queryByTestId } = await render(<RecipeDetailScreen />, { wrapper });
    await findByText("肉じゃが");
    expect(queryByTestId("recipe-detail-edit")).toBeNull();
  });

  it("404 は「表示できません」を出す", async () => {
    mockGetRecipe.mockRejectedValue(new ApiError("レシピが見つかりません", "NOT_FOUND", 404));
    const { findByText } = await render(<RecipeDetailScreen />, { wrapper });
    expect(await findByText("表示できません")).toBeTruthy();
  });
});
