import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { logout } from "./api";
import { useLogout } from "./useLogout";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("./api", () => ({ logout: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: {
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockLogout = logout as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockLogout.mockReset();
  (secureStorage.deleteRefreshToken as jest.Mock).mockClear();
  (secureStorage.deleteUser as jest.Mock).mockClear();
  useSession.getState().clear();
});

describe("useLogout", () => {
  it("リフレッシュトークンがあれば API を呼び、セッションと secureStorage を消す", async () => {
    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      rememberMe: true,
    });
    mockLogout.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockLogout).toHaveBeenCalledWith({ refreshToken: "r" });
    expect(useSession.getState().isAuthenticated).toBe(false);
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
    expect(secureStorage.deleteUser).toHaveBeenCalled();
  });

  it("サーバーデータのキャッシュも捨てる（次のユーザーに前のユーザーのデータを見せない）", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sharedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    // ログアウト前に「前のユーザーの閲覧履歴」がキャッシュに載っている状態を作る。
    client.setQueryData(["history", "u1"], { pages: [{ items: [{ id: "secret" }] }] });

    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      user: { id: "u1", displayName: "テスト太郎" },
      rememberMe: true,
    });
    mockLogout.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useLogout(), { wrapper: sharedWrapper });
    result.current.mutate();

    await waitFor(() => expect(client.getQueryData(["history", "u1"])).toBeUndefined());
  });

  it("リフレッシュトークンが無ければ API を呼ばずローカルだけ消す", async () => {
    useSession.getState().clear();

    const { result } = await renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockLogout).not.toHaveBeenCalled();
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
  });

  it("API 呼び出しが失敗しても、ローカルのセッションは消す", async () => {
    useSession.getState().setAuth({ accessToken: "a", refreshToken: "r", rememberMe: false });
    mockLogout.mockRejectedValue(new Error("network error"));

    const { result } = await renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(useSession.getState().isAuthenticated).toBe(false);
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
  });
});
