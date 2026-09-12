/**
 * 自分のレシピ一覧の BB テスト（一覧表示・非公開バッジ・無限スクロール・空/エラー）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { MyRecipesScreen } from "../MyRecipesScreen";
import * as recipeApi from "@/features/recipe/api";
import { useSession } from "@/store/session";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/features/recipe/api", () => {
  const actual =
    jest.requireActual<typeof import("@/features/recipe/api")>("@/features/recipe/api");
  return { ...actual, listMyRecipes: jest.fn() };
});

const mockList = recipeApi.listMyRecipes as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function card(
  id: string,
  isPublic: boolean,
  title = `レシピ${id}`,
  avatarUrl: string | null = null,
) {
  return {
    id,
    title,
    thumbnailUrl: null,
    author: { id: `author-${id}`, displayName: `投稿者${id}`, avatarUrl },
    isPublic,
    createdAt: "2026-09-06T00:00:00Z",
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
  useSession.getState().clear();
  signIn();
});

describe("MyRecipesScreen", () => {
  it("一覧を表示し、非公開カードにバッジを出す", async () => {
    mockList.mockResolvedValue({
      items: [card("1", true), card("2", false)],
      nextCursor: null,
    });
    const { findByText, getByTestId, queryByTestId } = await render(
      <MyRecipesScreen basePath="/my-page" />,
      {
        wrapper,
      },
    );
    expect(await findByText("レシピ1")).toBeTruthy();
    expect(getByTestId("my-recipe-2-private-badge")).toBeTruthy();
    expect(queryByTestId("my-recipe-1-private-badge")).toBeNull();
  });

  it("投稿者の表示名とアバターを表示し、未設定なら頭文字を出す", async () => {
    mockList.mockResolvedValue({
      items: [
        card("1", true, "画像あり", "https://example.com/avatar.jpg"),
        card("2", true, "画像なし"),
      ],
      nextCursor: null,
    });
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <MyRecipesScreen basePath="/my-page" />,
      { wrapper },
    );

    expect((await findByTestId("my-recipe-1-avatar")).props.source).toEqual([
      { uri: "https://example.com/avatar.jpg" },
    ]);
    expect(getByTestId("my-recipe-1-author").props.children).toBe("投稿者1");
    expect(getByTestId("my-recipe-2-avatar-placeholder")).toBeTruthy();
    expect(queryByTestId("my-recipe-2-avatar")).toBeNull();
    expect(getByTestId("my-recipe-2-author").props.children).toBe("投稿者2");
  });

  it("カードタップで詳細へ push する", async () => {
    mockList.mockResolvedValue({ items: [card("1", true)], nextCursor: null });
    const { findByTestId } = await render(<MyRecipesScreen basePath="/my-page" />, { wrapper });
    await fireEvent.press(await findByTestId("my-recipe-1"));
    expect(mockPush).toHaveBeenCalledWith("/my-page/recipes/1");
  });

  it("nextCursor があれば onEndReached で次ページを取得する", async () => {
    mockList
      .mockResolvedValueOnce({ items: [card("1", true)], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [card("2", true)], nextCursor: null });

    const { findByText, getByTestId } = await render(<MyRecipesScreen basePath="/my-page" />, {
      wrapper,
    });
    await findByText("レシピ1");

    await fireEvent(getByTestId("my-recipes-list"), "onEndReached");
    expect(await findByText("レシピ2")).toBeTruthy();
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-1" }));
  });

  it("空なら空状態メッセージを出す", async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null });
    const { findByText } = await render(<MyRecipesScreen basePath="/my-page" />, { wrapper });
    expect(await findByText("まだレシピを投稿していません")).toBeTruthy();
  });

  it("エラーなら再試行ボタンを出し、押すと再取得する", async () => {
    mockList.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({
      items: [card("1", true)],
      nextCursor: null,
    });
    const { findByTestId, findByText } = await render(<MyRecipesScreen basePath="/my-page" />, {
      wrapper,
    });
    await fireEvent.press(await findByTestId("my-recipes-retry"));
    expect(await findByText("レシピ1")).toBeTruthy();
  });
});
