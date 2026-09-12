/**
 * フォロー・フォロワー画面のテスト（Issue #96）。
 *
 * BB: 初期タブ・タブ切替、自分の行にはボタンが無い、行タップの遷移先、空状態・失敗。
 * WB: 自分 / 他人の一覧の出し分け、行ごとのフォロー（楽観更新）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ConnectionsScreen } from "../ConnectionsScreen";
import { followUser, listConnections } from "@/features/follow/api";
import { getUser } from "@/features/profile/api";
import { useSession } from "@/store/session";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { id?: string; tab?: string } = { id: "u2" };
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));
jest.mock("@/features/follow/api", () => ({
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
  listConnections: jest.fn(),
}));
jest.mock("@/features/profile/api", () => ({
  getUser: jest.fn(),
  getMyProfile: jest.fn(),
}));

const mockListConnections = listConnections as jest.Mock;
const mockFollowUser = followUser as jest.Mock;
const mockGetUser = getUser as jest.Mock;

const rows = [
  { id: "u3", displayName: "testuser_003", avatarUrl: null, isFollowing: false },
  { id: "u1", displayName: "testuser_001", avatarUrl: null, isFollowing: false },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: "u2" };
  mockCanGoBack = true;
  useSession.getState().clear();
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id: "u1", displayName: "testuser_001" },
    rememberMe: false,
  });
  useSession.getState().setHydrated(true);
  mockListConnections.mockResolvedValue({ items: rows, nextCursor: null });
  mockGetUser.mockResolvedValue({ id: "u2", displayName: "testuser_002", links: {} });
});

describe("一覧の出し分け", () => {
  it("他人の一覧はその人の ID で「フォロー中」から取り、タイトルはその人の名前", async () => {
    const { findByText, findByTestId } = await render(<ConnectionsScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("connections-row-u3");
    expect(mockListConnections).toHaveBeenCalledWith("u2", "following", expect.any(Object));
    expect(await findByText("testuser_002")).toBeTruthy();
  });

  it("?tab=followers ならフォロワーから始める", async () => {
    mockParams = { id: "u2", tab: "followers" };
    const { findByTestId } = await render(<ConnectionsScreen basePath="/home" />, { wrapper });
    await findByTestId("connections-row-u3");
    expect(mockListConnections).toHaveBeenCalledWith("u2", "followers", expect.any(Object));
  });

  it("自分の一覧は me で取り、タイトルは「フォロー・フォロワー」", async () => {
    mockParams = {};
    const { findByText, findByTestId } = await render(
      <ConnectionsScreen basePath="/my-page" self />,
      { wrapper },
    );
    await findByTestId("connections-row-u3");
    expect(mockListConnections).toHaveBeenCalledWith("me", "following", expect.any(Object));
    expect(await findByText("フォロー・フォロワー")).toBeTruthy();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("タブを切り替えるとフォロワーを取る", async () => {
    const { findByTestId, getByTestId } = await render(<ConnectionsScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("connections-row-u3");
    await fireEvent.press(getByTestId("connections-tab-followers"));
    await waitFor(() =>
      expect(mockListConnections).toHaveBeenCalledWith("u2", "followers", expect.any(Object)),
    );
  });
});

describe("行", () => {
  it("自分の行にはフォローボタンを出さない", async () => {
    const { findByTestId, queryByTestId } = await render(<ConnectionsScreen basePath="/home" />, {
      wrapper,
    });
    await findByTestId("connections-row-u3");
    expect(queryByTestId("connections-row-u3-follow")).toBeTruthy();
    expect(queryByTestId("connections-row-u1-follow")).toBeNull();
  });

  it("他人の行はその人のプロフィールへ、自分の行はマイページへ", async () => {
    const { findByTestId, getByTestId } = await render(<ConnectionsScreen basePath="/home" />, {
      wrapper,
    });
    await fireEvent.press(await findByTestId("connections-row-u3"));
    expect(mockPush).toHaveBeenCalledWith("/home/users/u3");
    await fireEvent.press(getByTestId("connections-row-u1"));
    expect(mockNavigate).toHaveBeenCalledWith("/my-page");
  });

  it("行のフォローボタンは返事を待たずに「フォロー中」になる", async () => {
    mockFollowUser.mockReturnValue(new Promise(() => undefined));
    const { findByTestId, getByTestId } = await render(<ConnectionsScreen basePath="/home" />, {
      wrapper,
    });
    await fireEvent.press(await findByTestId("connections-row-u3-follow"));
    await waitFor(() =>
      expect(getByTestId("connections-row-u3-follow").props.accessibilityState.selected).toBe(true),
    );
    expect(mockFollowUser).toHaveBeenCalledWith("u3");
  });
});

describe("状態", () => {
  it.each([
    ["following", "まだ誰もフォローしていません"],
    ["followers", "まだフォロワーがいません"],
  ])("%s の空状態", async (tab, message) => {
    mockParams = { id: "u2", tab };
    mockListConnections.mockResolvedValue({ items: [], nextCursor: null });
    const { findByTestId } = await render(<ConnectionsScreen basePath="/home" />, { wrapper });
    expect((await findByTestId("connections-empty")).props.children).toBe(message);
  });

  it("失敗したら再試行できる", async () => {
    mockListConnections.mockRejectedValueOnce(new Error("network"));
    const { findByTestId } = await render(<ConnectionsScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("connections-retry"));
    expect(await findByTestId("connections-row-u3")).toBeTruthy();
  });

  it("戻り先が無ければ destination の根へ置き換える", async () => {
    mockCanGoBack = false;
    const { getByTestId } = await render(<ConnectionsScreen basePath="/home" />, { wrapper });
    await fireEvent.press(getByTestId("connections-back"));
    expect(mockReplace).toHaveBeenCalledWith("/home");
  });
});
