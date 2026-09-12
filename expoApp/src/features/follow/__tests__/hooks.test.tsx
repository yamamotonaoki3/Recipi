/**
 * フォローの hooks のテスト（WB: 楽観更新・巻き戻し・ユーザー切替・取得の条件）。
 */
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { profileKeys } from "@/features/profile/hooks";
import { useSession } from "@/store/session";

import { followUser, listConnections, unfollowUser, type UserRowListResponse } from "../api";
import { connectionKeys, useConnections, useToggleFollow } from "../hooks";

jest.mock("../api", () => ({
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
  listConnections: jest.fn(),
}));

const mockFollowUser = followUser as jest.Mock;
const mockUnfollowUser = unfollowUser as jest.Mock;
const mockListConnections = listConnections as jest.Mock;

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const other = {
  id: "u2",
  displayName: "testuser_002",
  avatarUrl: null,
  followingCount: 3,
  followerCount: 5,
  isFollowing: false,
  links: {},
};
const other3 = {
  ...other,
  id: "u3",
  displayName: "testuser_003",
};
const me = {
  id: "u1",
  displayName: "testuser_001",
  avatarUrl: null,
  followingCount: 1,
  followerCount: 0,
  isFollowing: null,
};
const connections: InfiniteData<UserRowListResponse> = {
  pages: [
    {
      items: [
        { id: "u2", displayName: "testuser_002", avatarUrl: null, isFollowing: false },
        { id: "u3", displayName: "testuser_003", avatarUrl: null, isFollowing: false },
      ],
      nextCursor: null,
    },
  ],
  pageParams: [undefined],
};

function login(id = "u1") {
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id, displayName: "testuser" },
    rememberMe: false,
  });
  useSession.getState().setHydrated(true);
}

/** 解決を外から操作できる Promise（楽観更新の途中の状態を確かめるため）。 */
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seedCache() {
  client.setQueryData(profileKeys.detail("u2"), { ...other });
  client.setQueryData(profileKeys.detail("u1"), { ...me });
  client.setQueryData(connectionKeys.list("me", "following"), connections);
}

const followerCountOf = () =>
  client.getQueryData<typeof other>(profileKeys.detail("u2"))?.followerCount;
const followingCountOfMe = () =>
  client.getQueryData<typeof me>(profileKeys.detail("u1"))?.followingCount;
const rowFollowing = () => rowFollowingOf("u2");
const rowFollowingOf = (userId: string) =>
  client
    .getQueryData<InfiniteData<UserRowListResponse>>(connectionKeys.list("me", "following"))
    ?.pages[0].items.find((row) => row.id === userId)?.isFollowing;

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  useSession.getState().clear();
  useSession.getState().setHydrated(false);
});

describe("useConnections", () => {
  it("セッション復元前は送らない", async () => {
    await renderHook(() => useConnections("me", "following"), { wrapper });
    expect(mockListConnections).not.toHaveBeenCalled();
  });

  it("対象とタブを渡して取得し、次ページのカーソルを使う", async () => {
    login();
    mockListConnections.mockResolvedValueOnce({ items: [], nextCursor: "c2" });
    mockListConnections.mockResolvedValueOnce({ items: [], nextCursor: null });

    const { result } = await renderHook(() => useConnections("u2", "followers"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListConnections).toHaveBeenCalledWith("u2", "followers", {
      cursor: undefined,
      limit: 20,
    });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mockListConnections).toHaveBeenLastCalledWith("u2", "followers", {
      cursor: "c2",
      limit: 20,
    });
    // 次ページの取得後の再描画を待ってから読む（直後は古い値のまま）。
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it("対象が無ければ送らない", async () => {
    login();
    await renderHook(() => useConnections(undefined, "following"), { wrapper });
    expect(mockListConnections).not.toHaveBeenCalled();
  });
});

describe("useToggleFollow（楽観更新）", () => {
  it("返事を待たずにボタン・フォロワー数・自分のフォロー数・一覧の行を書き換える", async () => {
    login();
    seedCache();
    const pending = deferred();
    mockFollowUser.mockReturnValue(pending.promise);

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      result.current.mutate({ userId: "u2", follow: true });
    });

    // まだサーバーは返事をしていないが、表示は先に変わっている。
    await waitFor(() => expect(followerCountOf()).toBe(6));
    expect(client.getQueryData<typeof other>(profileKeys.detail("u2"))?.isFollowing).toBe(true);
    expect(followingCountOfMe()).toBe(2);
    expect(rowFollowing()).toBe(true);

    await act(async () => {
      pending.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFollowUser).toHaveBeenCalledWith("u2");
  });

  it("解除は数を 1 減らし、解除の API を呼ぶ", async () => {
    login();
    seedCache();
    client.setQueryData(profileKeys.detail("u2"), { ...other, isFollowing: true });
    mockUnfollowUser.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u2", follow: false });
    });

    expect(mockUnfollowUser).toHaveBeenCalledWith("u2");
    expect(followerCountOf()).toBe(4);
    expect(followingCountOfMe()).toBe(0);
  });

  it("失敗したら控えておいた値に戻す", async () => {
    login();
    seedCache();
    mockFollowUser.mockRejectedValue(new Error("network"));

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u2", follow: true }).catch(() => undefined);
    });

    expect(followerCountOf()).toBe(5);
    expect(client.getQueryData<typeof other>(profileKeys.detail("u2"))?.isFollowing).toBe(false);
    expect(followingCountOfMe()).toBe(1);
    expect(rowFollowing()).toBe(false);
  });

  it("既に同じ状態なら相手のフォロワー数を二重に足さない", async () => {
    login();
    seedCache();
    client.setQueryData(profileKeys.detail("u2"), { ...other, isFollowing: true });
    mockFollowUser.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u2", follow: true });
    });

    expect(followerCountOf()).toBe(5);
    expect(followingCountOfMe()).toBe(1);
  });

  it("2人を続けて操作して1人だけ失敗しても、もう1人の楽観更新は残す", async () => {
    login();
    seedCache();
    client.setQueryData(profileKeys.detail("u3"), { ...other3 });
    const u2Request = deferred();
    const u3Request = deferred();
    mockFollowUser.mockImplementation((userId: string) =>
      userId === "u2" ? u2Request.promise : u3Request.promise,
    );

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      result.current.mutate({ userId: "u2", follow: true });
      result.current.mutate({ userId: "u3", follow: true });
    });

    await waitFor(() => expect(followingCountOfMe()).toBe(3));
    expect(rowFollowingOf("u2")).toBe(true);
    expect(rowFollowingOf("u3")).toBe(true);

    await act(async () => {
      u2Request.reject(new Error("network"));
    });
    await waitFor(() => expect(rowFollowingOf("u2")).toBe(false));
    expect(followerCountOf()).toBe(5);
    expect(followingCountOfMe()).toBe(2);
    expect(rowFollowingOf("u3")).toBe(true);

    await act(async () => {
      u3Request.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("相手のプロフィールがなく一覧の行だけあるときは、自分のフォロー数を足す", async () => {
    login();
    seedCache();
    client.removeQueries({ queryKey: profileKeys.detail("u2") });
    mockFollowUser.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u2", follow: true });
    });

    expect(client.getQueryData(profileKeys.detail("u2"))).toBeUndefined();
    expect(rowFollowing()).toBe(true);
    expect(followingCountOfMe()).toBe(2);
  });

  it("押す前の状態がどこにもなければ、フォロー数を動かさない", async () => {
    login();
    client.setQueryData(profileKeys.detail("u1"), { ...me });
    mockFollowUser.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u2", follow: true });
    });

    expect(followingCountOfMe()).toBe(1);
  });

  it("途中でユーザーが入れ替わったら、巻き戻しも張り替えもしない", async () => {
    login("u1");
    seedCache();
    const pending = deferred();
    mockFollowUser.mockReturnValue(pending.promise);
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      result.current.mutate({ userId: "u2", follow: true });
    });
    await waitFor(() => expect(followerCountOf()).toBe(6));

    // 別のユーザーでログインし直した後に、前のユーザーの操作が失敗した。
    login("u9");
    await act(async () => {
      pending.reject(new Error("network"));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // 前のユーザーの控えで今のキャッシュを書き戻さない・張り替えもしない。
    expect(followerCountOf()).toBe(6);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("ログインしていなければキャッシュを書き換えない", async () => {
    useSession.getState().setHydrated(true);
    seedCache();
    mockFollowUser.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u2", follow: true });
    });

    expect(followerCountOf()).toBe(5);
  });
});
