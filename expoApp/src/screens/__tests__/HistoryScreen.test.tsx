/**
 * 閲覧履歴画面のテスト（screens/history.md）。
 *
 * BB: 一覧表示・空状態・エラー・無限スクロール
 * WB: 消去の確認ダイアログ（キャンセル / 実行）と失敗時の分岐
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import type { ReactNode } from "react";

import { HistoryScreen } from "../HistoryScreen";
import * as historyApi from "@/features/history/api";
import { useRecordView } from "@/features/history/hooks";
import { useSession } from "@/store/session";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/features/history/api", () => {
  const actual =
    jest.requireActual<typeof import("@/features/history/api")>("@/features/history/api");
  return { ...actual, getHistory: jest.fn(), clearHistory: jest.fn(), recordRecipeView: jest.fn() };
});

const mockGetHistory = historyApi.getHistory as jest.Mock;
const mockClearHistory = historyApi.clearHistory as jest.Mock;
const mockRecordView = historyApi.recordRecipeView as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function item(id: string, title = `レシピ${id}`) {
  return {
    id,
    title,
    thumbnailUrl: null,
    author: { id: `u${id}`, displayName: `投稿者${id}`, avatarUrl: null },
    favoriteCount: 0,
    viewedAt: "2026-09-10T00:00:00Z",
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

describe("HistoryScreen", () => {
  it("最近見た順に一覧を表示する", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1"), item("2")], nextCursor: null });
    const { findByText, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });

    expect(await findByText("レシピ1")).toBeTruthy();
    expect(getByTestId("history-recipe-2-author").props.children).toBe("投稿者2");
  });

  it("カードタップで詳細へ push する", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    const { findByTestId } = await render(<HistoryScreen basePath="/history" />, { wrapper });
    await fireEvent.press(await findByTestId("history-recipe-1"));
    expect(mockPush).toHaveBeenCalledWith("/history/recipes/1");
  });

  it("空なら空状態メッセージを出し、消去ボタンを無効にする", async () => {
    mockGetHistory.mockResolvedValue({ items: [], nextCursor: null });
    const { findByTestId, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });

    expect(await findByTestId("history-empty")).toBeTruthy();
    expect(getByTestId("history-clear").props.accessibilityState?.disabled).toBe(true);
  });

  it("消去はいきなり実行せず、確認ダイアログを出す", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    const { findByText, getByTestId, findByTestId } = await render(
      <HistoryScreen basePath="/history" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("history-clear"));

    expect(await findByTestId("history-clear-dialog")).toBeTruthy();
    expect(mockClearHistory).not.toHaveBeenCalled();
  });

  it("確認ダイアログをキャンセルすると消去しない", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    const { findByText, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("history-clear"));
    await fireEvent.press(getByTestId("history-clear-dialog-cancel"));

    expect(mockClearHistory).not.toHaveBeenCalled();
  });

  it("確認して実行すると消去し、空状態になる", async () => {
    mockGetHistory
      .mockResolvedValueOnce({ items: [item("1")], nextCursor: null })
      .mockResolvedValue({ items: [], nextCursor: null });
    mockClearHistory.mockResolvedValue(undefined);

    const { findByText, getByTestId, findByTestId } = await render(
      <HistoryScreen basePath="/history" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("history-clear"));
    await fireEvent.press(getByTestId("history-clear-dialog-confirm"));

    expect(mockClearHistory).toHaveBeenCalledTimes(1);
    expect(await findByTestId("history-empty")).toBeTruthy();
    // 破壊的操作なので「消えた」ことを知らせる（history.md §5）。
    expect(await findByTestId("history-cleared-snackbar")).toBeTruthy();
  });

  it("送信中の閲覧記録が決着してから消去する（消した履歴が復活しない）", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    mockClearHistory.mockResolvedValue(undefined);

    // 記録がまだ飛んでいる状態を作る。
    let finishRecord!: () => void;
    mockRecordView.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRecord = resolve;
      }),
    );
    const record = await renderHook(() => useRecordView(), { wrapper });
    await act(async () => {
      record.result.current.mutate("r-1");
    });

    const { findByText, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("history-clear"));
    await fireEvent.press(getByTestId("history-clear-dialog-confirm"));

    // 記録が決着するまで DELETE は飛ばない。
    expect(mockClearHistory).not.toHaveBeenCalled();

    await act(async () => {
      finishRecord();
    });

    await waitFor(() => expect(mockClearHistory).toHaveBeenCalledTimes(1));
  });

  // このファイルの他テストが「送信中の記録」に引きずられないよう、
  // 未解決の Promise を残さないこと（上のテストは finishRecord で必ず解決する）。

  it("消去中に始まった閲覧記録は送らない（消したものが復活しない）", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    // 消去を保留させ、その最中に記録を試みる。
    let finishClear!: () => void;
    mockClearHistory.mockReturnValue(
      new Promise<void>((resolve) => {
        finishClear = resolve;
      }),
    );
    mockRecordView.mockResolvedValue(undefined);

    const { findByText, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("history-clear"));
    await fireEvent.press(getByTestId("history-clear-dialog-confirm"));

    const record = await renderHook(() => useRecordView(), { wrapper });
    await act(async () => {
      record.result.current.mutate("r-1");
    });

    expect(mockRecordView).not.toHaveBeenCalled();

    await act(async () => {
      finishClear();
    });
    await waitFor(() => expect(mockClearHistory).toHaveBeenCalledTimes(1));
  });

  it("消去に失敗したら無言で閉じずにエラーを知らせる", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    mockClearHistory.mockRejectedValue(new Error("boom"));

    const { findByText, getByTestId, findByTestId } = await render(
      <HistoryScreen basePath="/history" />,
      { wrapper },
    );
    await findByText("レシピ1");

    await fireEvent.press(getByTestId("history-clear"));
    await fireEvent.press(getByTestId("history-clear-dialog-confirm"));

    expect(await findByTestId("history-clear-error-dialog")).toBeTruthy();
  });

  it("nextCursor があれば onEndReached で次ページを取得する", async () => {
    mockGetHistory
      .mockResolvedValueOnce({ items: [item("1")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [item("2")], nextCursor: null });

    const { findByText, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });
    await findByText("レシピ1");

    await fireEvent(getByTestId("history-list"), "onEndReached");
    expect(await findByText("レシピ2")).toBeTruthy();
    expect(mockGetHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-1" }),
    );
  });

  it("更新ボタンで再取得する（デスクトップ操作）", async () => {
    // 「更新」ボタンはデスクトップ（web / Tauri）だけに出す（history.md §7）。
    // `Platform.OS` は書き込み可能なので、テスト内だけ web に差し替える
    // （secureStorage のテストと同じやり方）。
    const originalOS = Platform.OS;
    Platform.OS = "web";
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    const { findByText, getByTestId } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });
    await findByText("レシピ1");
    const before = mockGetHistory.mock.calls.length;

    await fireEvent.press(getByTestId("history-refresh"));

    expect(mockGetHistory.mock.calls.length).toBeGreaterThan(before);
    Platform.OS = originalOS;
  });

  it("セッション復元前は認証必須の API を呼ばない", async () => {
    useSession.getState().clear();
    useSession.setState({ hydrated: false, isAuthenticated: false });
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });

    await render(<HistoryScreen basePath="/history" />, { wrapper });

    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("ユーザーが変わるとキャッシュを使い回さず取り直す（他人の履歴を見せない）", async () => {
    mockGetHistory.mockResolvedValue({ items: [item("1")], nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const a = await render(<HistoryScreen basePath="/history" />, { wrapper: shared });
    await a.findByText("レシピ1");
    expect(mockGetHistory).toHaveBeenCalledTimes(1);

    // 同じ QueryClient のまま別ユーザーに切り替える。
    useSession.setState({ user: { id: "u-other", displayName: "別の人" } });
    const b = await render(<HistoryScreen basePath="/history" />, { wrapper: shared });
    await b.findByText("レシピ1");

    expect(mockGetHistory).toHaveBeenCalledTimes(2);
  });

  it("エラーなら再試行ボタンを出し、押すと再取得する", async () => {
    mockGetHistory
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ items: [item("1")], nextCursor: null });

    const { findByTestId, findByText } = await render(<HistoryScreen basePath="/history" />, {
      wrapper,
    });
    await fireEvent.press(await findByTestId("history-retry"));
    expect(await findByText("レシピ1")).toBeTruthy();
  });
});
