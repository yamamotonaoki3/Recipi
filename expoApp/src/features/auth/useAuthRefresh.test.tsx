import { renderHook, waitFor } from "@testing-library/react-native";

import { useAuthRefresh } from "./useAuthRefresh";
import { api } from "@/api/client";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("@/api/client", () => ({ api: { POST: jest.fn() } }));
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
const mockGetRefreshToken = secureStorage.getRefreshToken as jest.Mock;
const mockGetUser = secureStorage.getUser as jest.Mock;

beforeEach(() => {
  mockPost.mockReset();
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

  it("refresh が失敗すれば not-restored になり、保存済みトークンを消す", async () => {
    mockGetRefreshToken.mockResolvedValue("stored-refresh");
    mockPost.mockResolvedValue({ data: undefined, error: { error: { code: "UNAUTHORIZED" } } });

    const { result } = await renderHook(() => useAuthRefresh());

    await waitFor(() => expect(result.current).toBe("not-restored"));
    expect(useSession.getState().isAuthenticated).toBe(false);
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
    expect(useSession.getState().hydrated).toBe(true);
  });
});
