import { act, fireEvent, render } from "@testing-library/react-native";
import { FlatList } from "react-native";

import { NotificationsScreen } from "../NotificationsScreen";
import type { NotificationItem } from "@/features/notification/api";
import { notifyRetap } from "@/features/navigation/retap";

const mockPush = jest.fn();
const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
const mockMarkRead = jest.fn();
const mockSync = jest.fn();

let mockQuery: Record<string, unknown>;

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/features/notification/hooks", () => ({
  useNotifications: () => mockQuery,
  useMarkNotificationsRead: () => ({ mutate: mockMarkRead, isPending: false }),
  useSyncUnreadCount: (count: number | undefined) => mockSync(count),
}));

const followed: NotificationItem = {
  id: "n1",
  type: "followed",
  readAt: null,
  createdAt: "2026-09-14T03:04:00Z",
  actor: { id: "u2", displayName: "花子", avatarUrl: null },
  recipe: null,
  comment: null,
};

const favorited: NotificationItem = {
  ...followed,
  id: "n2",
  type: "recipe_favorited",
  readAt: "2026-09-14T04:00:00Z",
  recipe: { id: "r1", title: "肉じゃが" },
};

function ready(items: NotificationItem[] = [], unreadCount = 0) {
  mockQuery = {
    data: { pages: [{ items, unreadCount, nextCursor: null }] },
    isPending: false,
    isError: false,
    isRefetching: false,
    refetch: mockRefetch,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: mockFetchNextPage,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ready();
});

describe("NotificationsScreen", () => {
  it("取得中はローディングを表示する", async () => {
    mockQuery = { ...mockQuery, isPending: true };
    const { getByTestId } = await render(<NotificationsScreen />);
    expect(getByTestId("notifications-loading")).toBeTruthy();
  });

  it("0件なら空状態を表示する", async () => {
    const { getByTestId } = await render(<NotificationsScreen />);
    expect(getByTestId("notifications-empty").props.children).toBe("通知はまだありません");
    expect(mockSync).toHaveBeenCalledWith(0);
  });

  it("未読を強調し、通知種別に応じた本文を表示する", async () => {
    ready([followed, favorited], 1);
    const { getByText, getByTestId, queryByTestId } = await render(<NotificationsScreen />);
    expect(getByText("花子さんがあなたをフォローしました")).toBeTruthy();
    expect(getByText("花子さんが「肉じゃが」をお気に入りに追加しました")).toBeTruthy();
    expect(getByTestId("notification-n1-unread")).toBeTruthy();
    expect(queryByTestId("notification-n2-unread")).toBeNull();
  });

  it("通知タップで未読化APIを呼んで対象へ遷移する", async () => {
    ready([followed, favorited], 1);
    const { getByTestId } = await render(<NotificationsScreen />);
    await fireEvent.press(getByTestId("notification-n1"));
    expect(mockMarkRead).toHaveBeenCalledWith(["n1"]);
    expect(mockPush).toHaveBeenCalledWith("/notifications/users/u2");

    await fireEvent.press(getByTestId("notification-n2"));
    expect(mockPush).toHaveBeenCalledWith("/notifications/recipes/r1");
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
  });

  it("選択中の通知 destination を再タップすると一覧を最上部へ戻す（Issue #249）", async () => {
    ready([followed, favorited], 1);
    const scrollTo = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => {});
    await render(<NotificationsScreen />);

    await act(async () => notifyRetap("/notifications"));
    expect(scrollTo).toHaveBeenCalledWith({ offset: 0, animated: true });

    scrollTo.mockClear();
    await act(async () => notifyRetap("/home"));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it("すべて既読を実行できる", async () => {
    ready([followed], 1);
    const { getByTestId } = await render(<NotificationsScreen />);
    await fireEvent.press(getByTestId("notifications-read-all"));
    expect(mockMarkRead).toHaveBeenCalledWith(undefined);
  });

  it("取得失敗時に再試行できる", async () => {
    // まだ 1 件も読めていない失敗（読めた分が残っている失敗は、一覧を残して末尾で再試行する。Issue #132）。
    mockQuery = { ...mockQuery, data: undefined, isError: true };
    const { getByTestId } = await render(<NotificationsScreen />);
    await fireEvent.press(getByTestId("notifications-retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("末尾で次ページを取得する", async () => {
    ready([followed], 1);
    mockQuery = { ...mockQuery, hasNextPage: true };
    const { getByTestId } = await render(<NotificationsScreen />);
    await fireEvent(getByTestId("notifications-list"), "endReached");
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("続きの読み込みに失敗しても一覧を残し、再試行は続きを読み直す（Issue #132）", async () => {
    ready([followed], 1);
    mockQuery = { ...mockQuery, hasNextPage: true, isError: true, isFetchNextPageError: true };
    const { getByTestId, getByText, queryByTestId } = await render(<NotificationsScreen />);

    expect(getByText("続きを読み込めませんでした")).toBeTruthy();
    expect(getByTestId("notification-n1")).toBeTruthy();
    expect(queryByTestId("notifications-retry")).toBeNull();

    await fireEvent.press(getByTestId("notifications-more-retry"));
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("取り直しに失敗しても一覧を残し、再試行は取り直す（Issue #132）", async () => {
    ready([followed], 1);
    mockQuery = { ...mockQuery, isError: true, isFetchNextPageError: false };
    const { getByTestId, getByText, queryByTestId } = await render(<NotificationsScreen />);

    expect(getByText("最新の状態を読み込めませんでした")).toBeTruthy();
    expect(getByTestId("notification-n1")).toBeTruthy();
    expect(queryByTestId("notifications-empty")).toBeNull();

    await fireEvent.press(getByTestId("notifications-refresh-retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockFetchNextPage).not.toHaveBeenCalled();
  });
});
