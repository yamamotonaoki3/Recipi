/**
 * ホーム画面のテスト（screens/home.md）。
 *
 * BB: 一覧表示・空状態・検索なし該当なし・エラー・無限スクロール
 * WB: 検索語の生成分岐（空 / 1 語 / 複数語）、準備中タブでは API を呼ばない分岐
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { HomeScreen } from "../HomeScreen";
import * as feedApi from "@/features/feed/api";
import { useSession } from "@/store/session";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/features/feed/api", () => {
  const actual = jest.requireActual<typeof import("@/features/feed/api")>("@/features/feed/api");
  return { ...actual, listFeed: jest.fn() };
});

const mockListFeed = feedApi.listFeed as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function card(id: string, title = `レシピ${id}`) {
  return {
    id,
    title,
    thumbnailUrl: null,
    author: { id: `u${id}`, displayName: `投稿者${id}`, avatarUrl: null },
    favoriteCount: 0,
  };
}

// hooks が「セッション復元済み かつ ログイン済み」でのみ問い合わせるように
// なったので（Codex #42 指摘の対策）、テストでもログイン状態を用意する。
function signIn() {
  useSession.setState({
    hydrated: true,
    isAuthenticated: true,
    accessToken: "test-token",
    refreshToken: "test-refresh",
    user: { id: "u-me", displayName: "テスト太郎" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useSession.getState().clear();
  signIn();
});

describe("HomeScreen", () => {
  it("「全体」フィードを新着順で表示し、投稿者名を出す", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1"), card("2")], nextCursor: null });
    const { findByText, getByTestId } = await render(<HomeScreen basePath="/home" />, { wrapper });

    expect(await findByText("レシピ1")).toBeTruthy();
    expect(getByTestId("feed-recipe-1-author").props.children).toBe("投稿者1");
    // 投稿者はアバター ＋ 表示名（components.md）。アバター画像は Phase 5 まで
    // null なので、そのあいだはプレースホルダを出す。
    expect(getByTestId("feed-recipe-1-avatar-placeholder")).toBeTruthy();
  });

  it("カードタップで詳細へ push する", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByTestId } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("feed-recipe-1"));
    expect(mockPush).toHaveBeenCalledWith("/home/recipes/1");
  });

  it("検索語なしのときは q を送らない", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await findByText("レシピ1");
    expect(mockListFeed).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
  });

  it("1 語で確定すると q に載せて検索する", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, getByTestId } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await findByText("レシピ1");

    await fireEvent.changeText(getByTestId("home-search-input"), "玉ねぎ");
    await fireEvent(getByTestId("home-search-input"), "submitEditing");

    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ q: "玉ねぎ" }));
  });

  it("複数語はそのまま q に載せる（分割はサーバー側の責務）", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, getByTestId } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await findByText("レシピ1");

    await fireEvent.changeText(getByTestId("home-search-input"), "  玉ねぎ 豚肉  ");
    await fireEvent(getByTestId("home-search-input"), "submitEditing");

    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ q: "玉ねぎ 豚肉" }));
  });

  it("検索語チップの × で通常フィードに戻る", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, findByTestId, getByTestId, queryByTestId } = await render(
      <HomeScreen basePath="/home" />,
      {
        wrapper,
      },
    );
    await findByText("レシピ1");

    await fireEvent.changeText(getByTestId("home-search-input"), "玉ねぎ");
    await fireEvent(getByTestId("home-search-input"), "submitEditing");
    expect(await findByTestId("home-search-chip")).toBeTruthy();

    await fireEvent.press(getByTestId("home-search-chip"));
    expect(queryByTestId("home-search-chip")).toBeNull();
    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined }));
  });

  it("準備中のサブタブを選ぶと API を呼ばずに「準備中」を出す", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");
    mockListFeed.mockClear();

    await fireEvent.press(getByTestId("home-subtab-following"));

    expect(await findByTestId("home-tab-not-ready")).toBeTruthy();
    expect(mockListFeed).not.toHaveBeenCalled();
  });

  it("空なら空状態メッセージを出す", async () => {
    mockListFeed.mockResolvedValue({ items: [], nextCursor: null });
    const { findByText } = await render(<HomeScreen basePath="/home" />, { wrapper });
    expect(await findByText("まだレシピがありません")).toBeTruthy();
  });

  it("検索して該当なしなら検索語つきの空状態を出す", async () => {
    mockListFeed.mockResolvedValue({ items: [], nextCursor: null });
    const { findByText, getByTestId } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await findByText("まだレシピがありません");

    await fireEvent.changeText(getByTestId("home-search-input"), "存在しない語");
    await fireEvent(getByTestId("home-search-input"), "submitEditing");

    expect(await findByText("「存在しない語」に一致するレシピは見つかりませんでした")).toBeTruthy();
  });

  it("nextCursor があれば onEndReached で次ページを取得する", async () => {
    mockListFeed
      .mockResolvedValueOnce({ items: [card("1")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [card("2")], nextCursor: null });

    const { findByText, getByTestId } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await findByText("レシピ1");

    await fireEvent(getByTestId("home-feed-list"), "onEndReached");
    expect(await findByText("レシピ2")).toBeTruthy();
    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-1" }));
  });

  it("入力をバックスペースで空にしても通常フィードに戻る（× を押さなくても）", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, findByTestId, getByTestId, queryByTestId } = await render(
      <HomeScreen basePath="/home" />,
      {
        wrapper,
      },
    );
    await findByText("レシピ1");

    await fireEvent.changeText(getByTestId("home-search-input"), "玉ねぎ");
    await fireEvent(getByTestId("home-search-input"), "submitEditing");
    expect(await findByTestId("home-search-chip")).toBeTruthy();

    await fireEvent.changeText(getByTestId("home-search-input"), "");

    expect(queryByTestId("home-search-chip")).toBeNull();
    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined }));
  });

  it("セッション復元前は認証必須の API を呼ばない（保存済みトークンを失わないため）", async () => {
    useSession.getState().clear();
    useSession.setState({ hydrated: false, isAuthenticated: false });
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });

    await render(<HomeScreen basePath="/home" />, { wrapper });

    expect(mockListFeed).not.toHaveBeenCalled();
  });

  it("エラーなら再試行ボタンを出し、押すと再取得する", async () => {
    mockListFeed
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ items: [card("1")], nextCursor: null });

    const { findByTestId, findByText } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("home-retry"));
    expect(await findByText("レシピ1")).toBeTruthy();
  });
});
