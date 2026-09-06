import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { signup } from "./api";
import { useSignup } from "./useSignup";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

jest.mock("./api", () => ({ signup: jest.fn() }));
jest.mock("@/lib/secureStorage", () => ({
  secureStorage: {
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockSignup = signup as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockSignup.mockReset();
  (secureStorage.deleteRefreshToken as jest.Mock).mockClear();
  (secureStorage.deleteUser as jest.Mock).mockClear();
  useSession.getState().clear();
});

describe("useSignup", () => {
  it("成功すると setAuth され、rememberMe は false になる", async () => {
    mockSignup.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { result } = await renderHook(() => useSignup(), { wrapper });
    result.current.mutate({
      email: "testuser_002@example.com",
      password: "TestPass123!",
      displayName: "太郎",
      securityQuestion: "好きな食べ物は？",
      securityAnswer: "ラーメン",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSession.getState().isAuthenticated).toBe(true);
    expect(useSession.getState().rememberMe).toBe(false);
    // 別アカウントの「ログインを保持」情報が残っていないよう、明示的に消す。
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
    expect(secureStorage.deleteUser).toHaveBeenCalled();
  });

  it("失敗すると isError になる", async () => {
    mockSignup.mockRejectedValue(new Error("409"));

    const { result } = await renderHook(() => useSignup(), { wrapper });
    result.current.mutate({
      email: "testuser_002@example.com",
      password: "TestPass123!",
      displayName: "太郎",
      securityQuestion: "好きな食べ物は？",
      securityAnswer: "ラーメン",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
