import { renderHook, waitFor } from "@testing-library/react-native";

import { useAuthRefresh } from "./useAuthRefresh";
import { api } from "@/api/client";
import { usesCookieAuth } from "@/lib/authPlatform";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("@/api/client", () => ({ api: { POST: jest.fn(), GET: jest.fn() } }));
jest.mock("@/lib/authPlatform", () => ({ usesCookieAuth: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: {
    getRefreshToken: jest.fn(),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn().mockResolvedValue(null),
    setUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockPost = api.POST as jest.Mock;
const mockGet = api.GET as jest.Mock;
const mockUsesCookieAuth = usesCookieAuth as jest.Mock;
const mockGetRefreshToken = secureStorage.getRefreshToken as jest.Mock;
const mockGetUser = secureStorage.getUser as jest.Mock;

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
  mockUsesCookieAuth.mockReturnValue(false);
  mockGetRefreshToken.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue(null);
  (secureStorage.setRefreshToken as jest.Mock).mockClear();
  (secureStorage.deleteRefreshToken as jest.Mock).mockClear();
  (secureStorage.setUser as jest.Mock).mockClear();
  (secureStorage.deleteUser as jest.Mock).mockClear();
  useSession.getState().clear();
  useSession.setState({ hydrated: false });
});

describe("useAuthRefresh", () => {
  it("保存済みトークンが無ければ not-restored になり、hydrated が true になる", async () => {
    mockGetRefreshToken.mockResolvedValue(null);

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("not-restored"));
    expect(useSession.getState().hydrated).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("保存済みトークンで refresh が成功すれば restored になり、setAuth される", async () => {
    mockGetRefreshToken.mockResolvedValue("stored-refresh");
    mockPost.mockResolvedValue({
      data: { accessToken: "new-access", refreshToken: "new-refresh" },
      error: undefined,
    });

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("restored"));
    expect(useSession.getState().accessToken).toBe("new-access");
    expect(useSession.getState().hydrated).toBe(true);
    expect(secureStorage.setRefreshToken).toHaveBeenCalledWith("new-refresh");
  });

  it("保存済みのユーザー情報があれば、refresh 成功時に一緒に復元する", async () => {
    mockGetRefreshToken.mockResolvedValue("stored-refresh");
    mockGetUser.mockResolvedValue(JSON.stringify({ id: "u1", displayName: "太郎" }));
    mockPost.mockResolvedValue({
      data: { accessToken: "new-access", refreshToken: "new-refresh" },
      error: undefined,
    });

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("restored"));
    expect(useSession.getState().user).toEqual({ id: "u1", displayName: "太郎" });
  });

  it("Webではrefresh成功後に現在ユーザーを取得して復元する", async () => {
    mockUsesCookieAuth.mockReturnValue(true);
    mockPost.mockResolvedValue({
      data: { accessToken: "new-access", refreshToken: null },
      error: undefined,
    });
    mockGet.mockResolvedValue({
      data: { id: "web-user", displayName: "Web太郎", avatarUrl: "https://example.com/avatar.png" },
      error: undefined,
      response: { status: 200 },
    });

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("restored"));
    expect(mockPost).toHaveBeenCalledWith("/api/v1/auth/refresh", { body: {} });
    expect(mockGet).toHaveBeenCalledWith("/api/v1/auth/me", {
      headers: { Authorization: "Bearer new-access" },
    });
    expect(useSession.getState().user).toEqual({
      id: "web-user",
      displayName: "Web太郎",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(secureStorage.setRefreshToken).not.toHaveBeenCalled();
  });

  it("Webで現在ユーザー取得が401なら認証状態を復元しない", async () => {
    mockUsesCookieAuth.mockReturnValue(true);
    mockPost.mockResolvedValue({
      data: { accessToken: "new-access", refreshToken: null },
      error: undefined,
    });
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: "UNAUTHORIZED" } },
      response: { status: 401 },
    });

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("not-restored"));
    expect(useSession.getState().isAuthenticated).toBe(false);
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
  });

  it("refresh が失敗すれば not-restored になり、保存済みトークンを消す", async () => {
    mockGetRefreshToken.mockResolvedValue("stored-refresh");
    mockPost.mockResolvedValue({ data: undefined, error: { error: { code: "UNAUTHORIZED" } } });

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("not-restored"));
    expect(useSession.getState().isAuthenticated).toBe(false);
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
    expect(useSession.getState().hydrated).toBe(true);
  });

  describe("Web の rememberMe の復元（Issue #275）", () => {
    async function restoreOnWeb(stored: string | null) {
      mockUsesCookieAuth.mockReturnValue(true);
      // jest（ネイティブ環境）には window.localStorage が無いので代用品を差し込む。
      const data = new Map<string, string>(stored === null ? [] : [["recipi.rememberMe", stored]]);
      Object.defineProperty(globalThis, "window", {
        value: {
          localStorage: {
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => void data.set(k, v),
          },
        },
        configurable: true,
        writable: true,
      });
      mockPost.mockResolvedValue({
        data: { accessToken: "a", refreshToken: null },
        error: undefined,
      });
      mockGet.mockResolvedValue({
        data: { id: "u", displayName: "N", avatarUrl: null },
        error: undefined,
        response: { status: 200 },
      });
      const { result } = await renderHook(() => useAuthRefresh());
      await waitFor(() => expect(result.current).toBe("restored"));
    }

    it("保持 OFF でログインしていたなら、再読み込み後も false のまま", async () => {
      await restoreOnWeb("0");
      expect(useSession.getState().rememberMe).toBe(false);
    });

    it("保持 ON でログインしていたなら true", async () => {
      await restoreOnWeb("1");
      expect(useSession.getState().rememberMe).toBe(true);
    });

    it("控えが無ければ false（勝手に長期 Cookie へ切り替えない）", async () => {
      await restoreOnWeb(null);
      expect(useSession.getState().rememberMe).toBe(false);
    });
  });
});
