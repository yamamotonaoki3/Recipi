/**
 * ユーザープロフィール（他人）画面のテスト（Issue #96）。
 *
 * BB: 状態（読み込み中 / 404 / 失敗）、公開 ON の項目だけ表示、レシピ一覧・空状態、
 *     自分の ID ならマイページへ。
 * WB: フォローの楽観更新（返事を待たずに表記と数が変わる）、失敗で元に戻る。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Linking } from "react-native";

import { UserProfileScreen } from "../UserProfileScreen";
import { ApiError } from "@/features/auth/api";
import { followUser } from "@/features/follow/api";
import { getUser, listUserRecipes } from "@/features/profile/api";
import { useSession } from "@/store/session";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockId = "u2";

jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useLocalSearchParams: () => ({ id: mockId }),
    useRouter: () => ({
      push: mockPush,
      back: mockBack,
      replace: mockReplace,
      canGoBack: () => true,
    }),
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: "redirect" }, href),
  };
});
jest.mock("@/features/profile/api", () => ({
  getUser: jest.fn(),
  listUserRecipes: jest.fn(),
  getMyProfile: jest.fn(),
}));
jest.mock("@/features/follow/api", () => ({
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
  listConnections: jest.fn(),
}));

const mockGetUser = getUser as jest.Mock;
const mockListUserRecipes = listUserRecipes as jest.Mock;
const mockFollowUser = followUser as jest.Mock;

const other = {
  id: "u2",
  displayName: "testuser_002",
  avatarUrl: null,
  followingCount: 3,
  followerCount: 5,
  isFollowing: false,
  email: "testuser_002@example.com",
  links: { instagram: "https://instagram.example.com/testuser_002" },
};

const recipe = {
  id: "r1",
  title: "[E2E_TEST] テストカレー",
  thumbnailUrl: null,
  author: { id: "u2", displayName: "testuser_002", avatarUrl: null },
  favoriteCount: 0,
  isFavorited: false,
  isPublic: true,
  createdAt: "2026-09-01T00:00:00Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderLoaded() {
  const utils = await render(<UserProfileScreen basePath="/home" />, { wrapper });
  await utils.findByTestId("user-profile-display-name");
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockId = "u2";
  useSession.getState().clear();
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id: "u1", displayName: "testuser_001" },
    rememberMe: false,
  });
  useSession.getState().setHydrated(true);
  mockGetUser.mockResolvedValue({ ...other });
  mockListUserRecipes.mockResolvedValue({ items: [recipe], nextCursor: null });
});

describe("状態", () => {
  it("読み込み中はスケルトン", async () => {
    mockGetUser.mockReturnValue(new Promise(() => undefined));
    const { getByTestId } = await render(<UserProfileScreen basePath="/home" />, { wrapper });
    expect(getByTestId("user-profile-skeleton")).toBeTruthy();
  });

  it("404 は「このユーザーは見つかりません」で、再試行は出さない", async () => {
    mockGetUser.mockRejectedValue(new ApiError("見つかりません", "NOT_FOUND", 404));
    const { findByText, queryByTestId } = await render(<UserProfileScreen basePath="/home" />, {
      wrapper,
    });
    expect(await findByText("このユーザーは見つかりません")).toBeTruthy();
    expect(queryByTestId("user-profile-retry")).toBeNull();
  });

  it("それ以外の失敗は再試行できる", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("network"));
    const { findByTestId } = await render(<UserProfileScreen basePath="/home" />, { wrapper });
    await fireEvent.press(await findByTestId("user-profile-retry"));
    expect(await findByTestId("user-profile-display-name")).toBeTruthy();
  });

  it("戻るで前の画面へ", async () => {
    const { getByTestId } = await renderLoaded();
    await fireEvent.press(getByTestId("user-profile-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe("表示", () => {
  it("表示名・フォロー数・公開 ON の連絡先だけを出す", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const { getByTestId, queryByTestId } = await renderLoaded();

    expect(getByTestId("user-profile-display-name").props.children).toBe("testuser_002");
    expect(getByTestId("user-profile-link-email")).toBeTruthy();
    expect(getByTestId("user-profile-link-instagram")).toBeTruthy();
    // X とその他は公開されていない（レスポンスに無い）ので出さない。
    expect(queryByTestId("user-profile-link-x")).toBeNull();
    expect(queryByTestId("user-profile-link-other")).toBeNull();

    await fireEvent.press(getByTestId("user-profile-link-instagram"));
    expect(openURL).toHaveBeenCalledWith("https://instagram.example.com/testuser_002");
    await fireEvent.press(getByTestId("user-profile-link-email"));
    expect(openURL).toHaveBeenCalledWith("mailto:testuser_002@example.com");
  });

  it("公開された連絡先が無ければ欄ごと出さない", async () => {
    mockGetUser.mockResolvedValue({ ...other, email: undefined, links: {} });
    const { queryByTestId } = await renderLoaded();
    expect(queryByTestId("user-profile-links")).toBeNull();
  });

  it("その人のレシピを並べ、タップで詳細へ", async () => {
    const { findByTestId } = await renderLoaded();
    await fireEvent.press(await findByTestId("user-recipe-r1"));
    expect(mockPush).toHaveBeenCalledWith("/home/recipes/r1");
  });

  it("レシピが無ければ空状態", async () => {
    mockListUserRecipes.mockResolvedValue({ items: [], nextCursor: null });
    const { findByTestId } = await renderLoaded();
    expect((await findByTestId("user-profile-recipes-empty")).props.children).toBe(
      "まだ公開レシピがありません",
    );
  });

  it("フォロー数 / フォロワー数のタップで一覧の該当タブへ", async () => {
    const { getByTestId } = await renderLoaded();
    await fireEvent.press(getByTestId("user-profile-following"));
    expect(mockPush).toHaveBeenLastCalledWith("/home/users/u2/connections?tab=following");
    await fireEvent.press(getByTestId("user-profile-followers"));
    expect(mockPush).toHaveBeenLastCalledWith("/home/users/u2/connections?tab=followers");
  });
});

describe("自分のとき", () => {
  it("自分の ID ならマイページへ置き換え、取得もしない", async () => {
    mockId = "u1";
    const { getByTestId } = await render(<UserProfileScreen basePath="/home" />, { wrapper });
    expect(getByTestId("redirect").props.children).toBe("/my-page");
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("本人向けの形が返ってきたらマイページへ", async () => {
    mockGetUser.mockResolvedValue({ ...other, emailPublic: true });
    const { findByTestId } = await render(<UserProfileScreen basePath="/home" />, { wrapper });
    expect((await findByTestId("redirect")).props.children).toBe("/my-page");
  });
});

describe("フォロー（楽観更新）", () => {
  it("返事を待たずに「フォロー中」とフォロワー数 +1 を出す", async () => {
    let resolveFollow: () => void = () => undefined;
    mockFollowUser.mockReturnValue(new Promise<void>((r) => (resolveFollow = r)));
    const { getByTestId, findByText, queryByText } = await renderLoaded();

    await fireEvent.press(getByTestId("user-profile-follow"));

    expect(await findByText("フォロー中")).toBeTruthy();
    expect(queryByText("6")).toBeTruthy();
    // 送信中はボタンを押せない（二重送信しない）。
    expect(getByTestId("user-profile-follow").props.accessibilityState.disabled).toBe(true);

    // サーバーの返事の後の再取得でも同じ値が返る。
    mockGetUser.mockResolvedValue({ ...other, isFollowing: true, followerCount: 6 });
    await act(async () => {
      resolveFollow();
    });
    await waitFor(() =>
      expect(getByTestId("user-profile-follow").props.accessibilityState.disabled).toBe(false),
    );
    expect(mockFollowUser).toHaveBeenCalledWith("u2");
  });

  it("失敗したら「フォロー」と元の数に戻る", async () => {
    mockFollowUser.mockRejectedValue(new Error("network"));
    const { getByTestId, findByText, queryByText } = await renderLoaded();

    await fireEvent.press(getByTestId("user-profile-follow"));

    await waitFor(() =>
      expect(getByTestId("user-profile-follow").props.accessibilityState.disabled).toBe(false),
    );
    expect(await findByText("フォロー")).toBeTruthy();
    expect(queryByText("5")).toBeTruthy();
  });
});
