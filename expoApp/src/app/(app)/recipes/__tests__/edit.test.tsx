/**
 * レシピ編集画面の所有者ガード（他人のレシピは編集させない）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import EditRecipeScreen from "../[id]/edit";
import * as recipeApi from "@/features/recipe/api";
import type { RecipeResponse } from "@/features/recipe/api";
import { useSession } from "@/store/session";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ id: "r1" }),
  Stack: { Screen: () => null },
}));

jest.mock("@/features/recipe/api", () => {
  const actual =
    jest.requireActual<typeof import("@/features/recipe/api")>("@/features/recipe/api");
  return { ...actual, getRecipe: jest.fn(), getUnits: jest.fn() };
});

const mockGetRecipe = recipeApi.getRecipe as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeRecipe(authorId: string): RecipeResponse {
  return {
    id: "r1",
    author: { id: authorId, displayName: "投稿者" },
    title: "肉じゃが",
    description: "",
    servings: 2,
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
          { name: "芋", quantity: "1", unit: "個", placement: "suffix", refRecipe: null },
        ],
      },
    ],
    steps: [{ body: "煮る", imageUrl: null, imageKey: null }],
  };
}

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

beforeEach(() => {
  jest.clearAllMocks();
  (recipeApi.getUnits as jest.Mock).mockResolvedValue({ units: [] });
  useSession.getState().clear();
  signIn();
});

describe("EditRecipeScreen", () => {
  it("本人のレシピならエディタを表示する", async () => {
    useSession.setState({ user: { id: "me", displayName: "私" } });
    mockGetRecipe.mockResolvedValue(makeRecipe("me"));
    const { findByTestId } = await render(<EditRecipeScreen />, { wrapper });
    expect(await findByTestId("editor-title")).toBeTruthy();
  });

  it("他人のレシピ（公開）なら「表示できません」を出す", async () => {
    useSession.setState({ user: { id: "me", displayName: "私" } });
    mockGetRecipe.mockResolvedValue(makeRecipe("someone-else"));
    const { findByText, queryByTestId } = await render(<EditRecipeScreen />, { wrapper });
    expect(await findByText("表示できません")).toBeTruthy();
    expect(queryByTestId("editor-title")).toBeNull();
  });
});
