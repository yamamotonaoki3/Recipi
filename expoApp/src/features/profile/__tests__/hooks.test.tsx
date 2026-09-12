/**
 * プロフィール hooks のテスト（WB: 取得の条件・セッション反映・キャッシュ無効化）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { pickImage } from "@/features/image/pickImage";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

import { deleteAvatar, getMyProfile, putAvatar, updateMe } from "../api";
import {
  profileKeys,
  useAvatarUpload,
  useDeleteAvatar,
  useMyProfile,
  useUpdateProfile,
} from "../hooks";

jest.mock("../api", () => ({
  getMyProfile: jest.fn(),
  updateMe: jest.fn(),
  putAvatar: jest.fn(),
  deleteAvatar: jest.fn(),
}));
jest.mock("@/features/image/pickImage", () => ({ pickImage: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: { setUser: jest.fn().mockResolvedValue(undefined) },
}));

const mockGetMyProfile = getMyProfile as jest.Mock;
const mockUpdateMe = updateMe as jest.Mock;
const mockPutAvatar = putAvatar as jest.Mock;
const mockDeleteAvatar = deleteAvatar as jest.Mock;
const mockPickImage = pickImage as jest.Mock;

const selfProfile = {
  id: "u1",
  displayName: "旧名前",
  email: "testuser_001@example.com",
  avatarUrl: null,
};

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function login(rememberMe = false) {
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id: "u1", displayName: "旧名前" },
    rememberMe,
  });
  useSession.getState().setHydrated(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().clear();
  useSession.getState().setHydrated(false);
});

describe("useMyProfile", () => {
  it("セッション復元前は送らない", async () => {
    await renderHook(() => useMyProfile(), { wrapper });
    expect(mockGetMyProfile).not.toHaveBeenCalled();
  });

  it("復元後、自分の ID で取得する", async () => {
    login();
    mockGetMyProfile.mockResolvedValue(selfProfile);
    const { result } = await renderHook(() => useMyProfile(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(selfProfile));
    expect(mockGetMyProfile).toHaveBeenCalledWith("u1");
  });

  it("ログイン済みで復元後なのに user が無ければ missingUser を返す", async () => {
    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      user: null,
      rememberMe: false,
    });
    useSession.getState().setHydrated(true);

    const { result } = await renderHook(() => useMyProfile(), { wrapper });

    expect(result.current.missingUser).toBe(true);
    expect(mockGetMyProfile).not.toHaveBeenCalled();
  });
});

describe("useUpdateProfile", () => {
  it("表示名が変わったらセッションに反映し、関連キャッシュを無効化する", async () => {
    login();
    mockUpdateMe.mockResolvedValue({ ...selfProfile, displayName: "新名前" });
    const spy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ displayName: "新名前" });
    });

    expect(useSession.getState().user).toEqual({ id: "u1", displayName: "新名前" });
    expect(secureStorage.setUser).not.toHaveBeenCalled();
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["profile"], ["feed"], ["history"], ["my-recipes"], ["recipe"]]),
    );
  });

  it("rememberMe のときは secureStorage も更新する", async () => {
    login(true);
    mockUpdateMe.mockResolvedValue({ ...selfProfile, displayName: "新名前" });
    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ displayName: "新名前" });
    });
    expect(secureStorage.setUser).toHaveBeenCalledWith(
      JSON.stringify({ id: "u1", displayName: "新名前" }),
    );
  });

  it("表示名が変わらない更新ではセッションを触らない", async () => {
    login(true);
    mockUpdateMe.mockResolvedValue(selfProfile);
    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ xPublic: true });
    });
    expect(secureStorage.setUser).not.toHaveBeenCalled();
  });

  it("セッションに user が無くても例外にならない", async () => {
    mockUpdateMe.mockResolvedValue(selfProfile);
    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ displayName: "x" });
    });
    expect(useSession.getState().user).toBeNull();
  });
});

describe("アバター", () => {
  it("設定するとキャッシュの avatarUrl をその場で書き換える", async () => {
    login();
    client.setQueryData(profileKeys.detail("u1"), selfProfile);
    mockPickImage.mockResolvedValue({ uri: "file://a", file: new Blob(["x"]) });
    mockPutAvatar.mockResolvedValue({ avatarUrl: "https://example.com/new.jpg" });

    const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
    let url: string | null = null;
    await act(async () => {
      url = await result.current.pickAndSend();
    });

    expect(url).toBe("https://example.com/new.jpg");
    expect(client.getQueryData<typeof selfProfile>(profileKeys.detail("u1"))?.avatarUrl).toBe(
      "https://example.com/new.jpg",
    );
  });

  it("アップロード中にユーザーが変わったらキャッシュを書き換えない", async () => {
    login();
    client.setQueryData(profileKeys.detail("u1"), selfProfile);
    mockPickImage.mockResolvedValue({ uri: "file://a", file: new Blob(["x"]) });
    let resolveUpload: (value: { avatarUrl: string }) => void = () => {};
    mockPutAvatar.mockReturnValue(
      new Promise<{ avatarUrl: string }>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useAvatarUpload(), { wrapper });
    let pending: Promise<string | null> = Promise.resolve(null);
    await act(async () => {
      pending = result.current.pickAndSend();
      await Promise.resolve();
    });

    useSession.getState().setAuth({
      accessToken: "a2",
      refreshToken: "r2",
      user: { id: "u2", displayName: "別の名前" },
      rememberMe: false,
    });
    await act(async () => {
      resolveUpload({ avatarUrl: "https://example.com/new.jpg" });
      await pending;
    });

    expect(client.getQueryData<typeof selfProfile>(profileKeys.detail("u1"))?.avatarUrl).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("削除するとキャッシュの avatarUrl を null にする", async () => {
    login();
    client.setQueryData(profileKeys.detail("u1"), { ...selfProfile, avatarUrl: "https://a" });
    mockDeleteAvatar.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useDeleteAvatar(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(client.getQueryData<typeof selfProfile>(profileKeys.detail("u1"))?.avatarUrl).toBeNull();
  });

  it("削除中にユーザーが変わったらキャッシュを書き換えない", async () => {
    login();
    client.setQueryData(profileKeys.detail("u1"), { ...selfProfile, avatarUrl: "https://a" });
    let resolveDelete: () => void = () => {};
    mockDeleteAvatar.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useDeleteAvatar(), { wrapper });
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.mutateAsync();
      await Promise.resolve();
    });

    useSession.getState().setAuth({
      accessToken: "a2",
      refreshToken: "r2",
      user: { id: "u2", displayName: "別の名前" },
      rememberMe: false,
    });
    await act(async () => {
      resolveDelete();
      await pending;
    });

    expect(client.getQueryData<typeof selfProfile>(profileKeys.detail("u1"))?.avatarUrl).toBe(
      "https://a",
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("ログアウト後に成功が返っても例外にならない（キャッシュは触らない）", async () => {
    mockDeleteAvatar.mockResolvedValue(undefined);
    const { result } = await renderHook(() => useDeleteAvatar(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync()).resolves.toBeUndefined();
    });
    expect(client.getQueryData(profileKeys.detail("u1"))).toBeUndefined();
  });
});
