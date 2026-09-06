import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { updateMe } from "./api";
import { useUpdateProfile } from "./useUpdateProfile";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("./api", () => ({ updateMe: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: { setUser: jest.fn().mockResolvedValue(undefined) },
}));

const mockUpdateMe = updateMe as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockUpdateMe.mockReset();
  (secureStorage.setUser as jest.Mock).mockClear();
  useSession.getState().clear();
});

describe("useUpdateProfile", () => {
  it("成功すると、セッションの user.displayName を更新する", async () => {
    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      user: { id: "u1", displayName: "旧名前" },
      rememberMe: false,
    });
    mockUpdateMe.mockResolvedValue({ id: "u1", email: "a@example.com", displayName: "新名前" });

    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ displayName: "新名前" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSession.getState().user).toEqual({ id: "u1", displayName: "新名前" });
    expect(secureStorage.setUser).not.toHaveBeenCalled();
  });

  it("rememberMe=true のときは secureStorage のユーザー情報も更新する", async () => {
    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      user: { id: "u1", displayName: "旧名前" },
      rememberMe: true,
    });
    mockUpdateMe.mockResolvedValue({ id: "u1", email: "a@example.com", displayName: "新名前" });

    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ displayName: "新名前" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(secureStorage.setUser).toHaveBeenCalledWith(
      JSON.stringify({ id: "u1", displayName: "新名前" }),
    );
  });

  it("セッションに user が無い場合は何もしない（例外にならない）", async () => {
    mockUpdateMe.mockResolvedValue({ id: "u1", email: "a@example.com", displayName: "新名前" });

    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ displayName: "新名前" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSession.getState().user).toBeNull();
  });

  it("失敗すると isError になる", async () => {
    mockUpdateMe.mockRejectedValue(new Error("400"));

    const { result } = await renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ displayName: "" });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
