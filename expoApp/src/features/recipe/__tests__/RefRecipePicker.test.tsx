/**
 * RefRecipePicker の BB テスト（自分のレシピ一覧・編集中レシピの除外・選択）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import * as recipeApi from "../api";
import { RefRecipePicker } from "../RefRecipePicker";
import { useSession } from "@/store/session";

jest.mock("../api", () => {
  const actual = jest.requireActual<typeof import("../api")>("../api");
  return { ...actual, listMyRecipes: jest.fn() };
});

const mockList = recipeApi.listMyRecipes as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function card(id: string, title: string) {
  return { id, title, thumbnailUrl: null, isPublic: true, createdAt: "2026-09-06T00:00:00Z" };
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
  mockList.mockResolvedValue({
    items: [card("r1", "自家製だれ"), card("r2", "編集中のレシピ")],
    nextCursor: null,
  });
});

describe("RefRecipePicker", () => {
  it("編集中のレシピ（excludeRecipeId）は一覧に出さない", async () => {
    const { findByText, queryByText } = await render(
      <RefRecipePicker visible excludeRecipeId="r2" onSelect={jest.fn()} onClose={jest.fn()} />,
      { wrapper },
    );
    expect(await findByText("自家製だれ")).toBeTruthy();
    expect(queryByText("編集中のレシピ")).toBeNull();
  });

  it("項目をタップすると id とタイトルを onSelect に渡す", async () => {
    const onSelect = jest.fn();
    const { findByTestId } = await render(
      <RefRecipePicker visible onSelect={onSelect} onClose={jest.fn()} />,
      { wrapper },
    );
    await fireEvent.press(await findByTestId("ref-picker-item-r1"));
    expect(onSelect).toHaveBeenCalledWith({ id: "r1", title: "自家製だれ" });
  });

  it("検索欄に入力すると q 付きで再取得する", async () => {
    const { getByTestId, findByText } = await render(
      <RefRecipePicker visible onSelect={jest.fn()} onClose={jest.fn()} />,
      { wrapper },
    );
    await findByText("自家製だれ");
    await fireEvent.changeText(getByTestId("ref-picker-search"), "だれ");
    // useMyRecipes(q) の queryKey が変わり、q 付きで listMyRecipes が呼ばれる
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ q: "だれ" }));
  });
});
