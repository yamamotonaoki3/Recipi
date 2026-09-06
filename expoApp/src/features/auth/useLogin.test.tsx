/**
 * useLogin の単体テスト。
 * `./api` を jest.mock で差し替え、成功時にセッションストア・
 * secureStorage がどう更新されるかを確認する。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { login } from "./api";
import { useLogin } from "./useLogin";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("./api", () => ({ login: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: {
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
    setUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockLogin = login as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockLogin.mockReset();
  (secureStorage.setRefreshToken as jest.Mock).mockClear();
  (secureStorage.deleteRefreshToken as jest.Mock).mockClear();
  (secureStorage.setUser as jest.Mock).mockClear();
  (secureStorage.deleteUser as jest.Mock).mockClear();
  useSession.getState().clear();
});

describe("useLogin", () => {
  it("成功すると setAuth され、rememberMe=true なら secureStorage に保存する", async () => {
    mockLogin.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { result } = await renderHook(() => useLogin(), { wrapper });
    result.current.mutate({
      email: "testuser_001@example.com",
      password: "TestPass123!",
      rememberMe: true,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSession.getState().accessToken).toBe("access-1");
    expect(useSession.getState().user).toEqual({ id: "u1", displayName: "太郎" });
    expect(secureStorage.setRefreshToken).toHaveBeenCalledWith("refresh-1");
  });

  it("rememberMe=false なら secureStorage には保存せず、古いトークンを削除する", async () => {
    mockLogin.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { result } = await renderHook(() => useLogin(), { wrapper });
    result.current.mutate({
      email: "testuser_001@example.com",
      password: "TestPass123!",
      rememberMe: false,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(secureStorage.setRefreshToken).not.toHaveBeenCalled();
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
  });

  it("失敗すると isError になり、セッションは変わらない", async () => {
    mockLogin.mockRejectedValue(new Error("401"));

    const { result } = await renderHook(() => useLogin(), { wrapper });
    result.current.mutate({
      email: "testuser_001@example.com",
      password: "wrong",
      rememberMe: false,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(useSession.getState().isAuthenticated).toBe(false);
  });
});
