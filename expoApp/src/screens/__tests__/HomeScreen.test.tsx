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

  /**
   * 確定の経路は「キーボードの確定キー」と「検索ボタン」の 2 つある。
   * Android は確定が IME のアクションでしか起きず、Appium からは送れなかった
   * ため、押せるボタンを足した（Issue #74）。両方の経路を固定しておく。
   */
  it("検索ボタンでも確定できる", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, findByTestId, getByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.changeText(getByTestId("home-search-input"), "玉ねぎ");
    await fireEvent.press(getByTestId("home-search-submit"));

    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ q: "玉ねぎ" }));
    expect(await findByTestId("home-search-chip")).toBeTruthy();
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

  it("「お気に入りレシピ」は準備中のまま API を呼ばない（F4 で有効化）", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");
    mockListFeed.mockClear();

    await fireEvent.press(getByTestId("home-subtab-favorites"));

    expect(await findByTestId("home-tab-not-ready")).toBeTruthy();
    expect(mockListFeed).not.toHaveBeenCalled();
  });

  it("「全体」は feed=all で取得する", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText } = await render(<HomeScreen basePath="/home" />, { wrapper });
    await findByText("レシピ1");
    expect(mockListFeed).toHaveBeenCalledWith(expect.objectContaining({ feed: "all" }));
  });

  it.each([
    ["following", "気になる投稿者をフォローすると、ここに新着レシピが並びます"],
    ["followers", "フォロワーが増えると、その人のレシピがここに並びます"],
  ] as const)("「%s」タブはその feed で取得し、空ならタブごとの文言を出す", async (tab, empty) => {
    mockListFeed.mockImplementation(({ feed }: { feed: string }) =>
      Promise.resolve(
        feed === "all" ? { items: [card("1")], nextCursor: null } : { items: [], nextCursor: null },
      ),
    );
    const { findByText, getByTestId, findByTestId, queryByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.press(getByTestId(`home-subtab-${tab}`));

    expect((await findByTestId(`home-feed-empty-${tab}`)).props.children).toBe(empty);
    expect(mockListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ feed: tab }));
    expect(queryByTestId("home-tab-not-ready")).toBeNull();
  });

  it("「フォロー」タブのカードはその feed の中身を出し、タップで詳細へ", async () => {
    mockListFeed.mockImplementation(({ feed }: { feed: string }) =>
      Promise.resolve(
        feed === "following"
          ? { items: [card("9", "フォロー中の人のレシピ")], nextCursor: null }
          : { items: [card("1")], nextCursor: null },
      ),
    );
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("home-subtab-following"));
    await fireEvent.press(await findByTestId("feed-following-recipe-9"));

    expect(mockPush).toHaveBeenCalledWith("/home/recipes/9");
  });

  it("検索語は表示中のタブの feed と一緒に送る", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("home-subtab-followers"));
    await findByTestId("feed-followers-recipe-1");
    await fireEvent.changeText(getByTestId("home-search-input"), "玉ねぎ");
    await fireEvent.press(getByTestId("home-search-submit"));

    expect(mockListFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({ feed: "followers", q: "玉ねぎ" }),
    );
  });

  it("タブを行き来しても、前のタブの一覧は取り直さずに残る（スクロール位置の保持）", async () => {
    mockListFeed.mockImplementation(({ feed }: { feed: string }) =>
      Promise.resolve({ items: [card(feed === "all" ? "1" : "9")], nextCursor: null }),
    );
    // アプリの QueryProvider と同じく「30 秒は新しいまま」にする。これが無いと、
    // タブに戻っただけで「古い」と見なされて取り直してしまい、アプリと挙動が変わる。
    const freshWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
        }
      >
        {children}
      </QueryClientProvider>
    );
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper: freshWrapper },
    );
    await findByText("レシピ1");
    const allList = getByTestId("home-feed-list");

    await fireEvent.press(getByTestId("home-subtab-following"));
    await findByTestId("feed-following-recipe-9");
    // 「全体」の一覧は消えずに隠れているだけ（同じ要素がそのまま残る）。
    // 隠れた要素は既定では検索対象から外れる（display: none）ので、含めて探す。
    expect(getByTestId("home-feed-list", { includeHiddenElements: true })).toBe(allList);
    // 隠れている間は、画面上からは見えない（押せない）。
    expect(() => getByTestId("home-feed-list")).toThrow();

    const callsBefore = mockListFeed.mock.calls.length;
    await fireEvent.press(getByTestId("home-subtab-all"));

    expect(getByTestId("home-feed-list")).toBe(allList);
    expect(mockListFeed.mock.calls.length).toBe(callsBefore);
  });

  it("隠れているタブは検索語を変えても取得しない（表示中のタブだけが取り直す）", async () => {
    mockListFeed.mockResolvedValue({ items: [card("1")], nextCursor: null });
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");
    await fireEvent.press(getByTestId("home-subtab-following"));
    await findByTestId("feed-following-recipe-1");
    mockListFeed.mockClear();

    await fireEvent.changeText(getByTestId("home-search-input"), "玉ねぎ");
    await fireEvent.press(getByTestId("home-search-submit"));
    await findByTestId("home-search-chip");

    const feeds = mockListFeed.mock.calls.map(([arg]) => (arg as { feed: string }).feed);
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds.every((f) => f === "following")).toBe(true);
  });

  it("フォロー / フォロワーのタブでも失敗したら再試行できる", async () => {
    mockListFeed.mockImplementation(({ feed }: { feed: string }) =>
      feed === "following"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ items: [card("1")], nextCursor: null }),
    );
    const { findByText, getByTestId, findByTestId } = await render(
      <HomeScreen basePath="/home" />,
      { wrapper },
    );
    await findByText("レシピ1");
    await fireEvent.press(getByTestId("home-subtab-following"));

    mockListFeed.mockImplementation(() =>
      Promise.resolve({ items: [card("9")], nextCursor: null }),
    );
    await fireEvent.press(await findByTestId("home-retry-following"));

    expect(await findByTestId("feed-following-recipe-9")).toBeTruthy();
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
