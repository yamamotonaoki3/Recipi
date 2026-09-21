import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { changeEmail } from "./api";
import { EmailChangeUncertainError, useChangeEmail } from "./hooks";
import { ApiError } from "@/features/auth/api";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("./api", () => ({ changeEmail: jest.fn() }));
jest.mock("@/lib/authPlatform", () => ({ usesCookieAuth: jest.fn(() => false) }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: {
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    setUser: jest.fn().mockResolvedValue(undefined),
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockChangeEmail = changeEmail as jest.MockedFunction<typeof changeEmail>;

function makeWrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
  useSession.getState().clear();
});

it("変更成功時は新しいトークンを保存してセッションを更新する", async () => {
  useSession.getState().setAuth({
    accessToken: "old-access",
    refreshToken: "old-refresh",
    user: { id: "u1", displayName: "太郎" },
    rememberMe: true,
  });
  mockChangeEmail.mockResolvedValue({
    user: { id: "u1", displayName: "太郎" },
    accessToken: "new-access",
    refreshToken: "new-refresh",
  });
  const client = new QueryClient();
  const { result } = await renderHook(() => useChangeEmail(), { wrapper: makeWrapper(client) });
  await act(async () => {
    await result.current.mutateAsync({ currentPassword: "TestPass123!", email: "new@example.com" });
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mockChangeEmail).toHaveBeenCalledWith({
    currentPassword: "TestPass123!",
    email: "new@example.com",
    rememberMe: true,
  });
  expect(secureStorage.setRefreshToken).toHaveBeenCalledWith("new-refresh");
  expect(secureStorage.setUser).toHaveBeenCalled();
  expect(useSession.getState()).toMatchObject({
    accessToken: "new-access",
    refreshToken: "new-refresh",
  });
});

it("rememberMe=false では永続化トークンを保存しない", async () => {
  useSession
    .getState()
    .setAuth({ accessToken: "old-access", refreshToken: "old-refresh", rememberMe: false });
  mockChangeEmail.mockResolvedValue({
    user: { id: "u1", displayName: "太郎" },
    accessToken: "new-access",
    refreshToken: "new-refresh",
  });
  const client = new QueryClient();
  const { result } = await renderHook(() => useChangeEmail(), { wrapper: makeWrapper(client) });
  await act(async () => {
    await result.current.mutateAsync({ currentPassword: "TestPass123!", email: "new@example.com" });
  });
  expect(secureStorage.setRefreshToken).not.toHaveBeenCalled();
  expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
  expect(useSession.getState().accessToken).toBe("new-access");
});

describe("結果が不確かな失敗（Issue #276）", () => {
  async function run() {
    const client = new QueryClient();
    const { result } = await renderHook(() => useChangeEmail(), { wrapper: makeWrapper(client) });
    let caught: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ currentPassword: "TestPass123!", email: "new@example.com" })
        .catch((e: unknown) => (caught = e));
    });
    return caught;
  }

  it("応答が無い（ネットワーク断）なら unknown", async () => {
    mockChangeEmail.mockRejectedValue(new TypeError("Network request failed"));
    const error = await run();
    expect(error).toBeInstanceOf(EmailChangeUncertainError);
    expect((error as EmailChangeUncertainError).kind).toBe("unknown");
  });

  it("サーバーの応答エラー（ApiError）はそのまま投げる（変更されていない）", async () => {
    const apiError = new ApiError("x", "REAUTH_FAILED", 403);
    mockChangeEmail.mockRejectedValue(apiError);
    expect(await run()).toBe(apiError);
  });

  it("成功後に保存が失敗したら committed。セッションは新しいトークンに置き換えない", async () => {
    useSession
      .getState()
      .setAuth({ accessToken: "old-access", refreshToken: "old-refresh", rememberMe: true });
    mockChangeEmail.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    (secureStorage.setRefreshToken as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    const error = await run();
    expect(error).toBeInstanceOf(EmailChangeUncertainError);
    expect((error as EmailChangeUncertainError).kind).toBe("committed");
    expect(useSession.getState().accessToken).toBe("old-access");
  });
});
