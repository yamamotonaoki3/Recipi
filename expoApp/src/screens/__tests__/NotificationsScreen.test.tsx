import { fireEvent, render } from "@testing-library/react-native";

import { NotificationsScreen } from "../NotificationsScreen";
import type { NotificationItem } from "@/features/notification/api";

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

  it("すべて既読を実行できる", async () => {
    ready([followed], 1);
    const { getByTestId } = await render(<NotificationsScreen />);
    await fireEvent.press(getByTestId("notifications-read-all"));
    expect(mockMarkRead).toHaveBeenCalledWith(undefined);
  });

  it("取得失敗時に再試行できる", async () => {
    mockQuery = { ...mockQuery, isError: true };
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
});
