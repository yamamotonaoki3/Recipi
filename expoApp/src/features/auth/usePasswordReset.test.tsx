import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { confirmPasswordReset, requestPasswordReset } from "./api";
import { useConfirmPasswordReset, useRequestPasswordReset } from "./usePasswordReset";

jest.mock("./api", () => ({
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
}));

const mockRequest = requestPasswordReset as jest.Mock;
const mockConfirm = confirmPasswordReset as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockRequest.mockReset();
  mockConfirm.mockReset();
});

describe("useRequestPasswordReset", () => {
  it("成功すると securityQuestion を含むデータを返す", async () => {
    mockRequest.mockResolvedValue({ securityQuestion: "好きな食べ物は？" });

    const { result } = await renderHook(() => useRequestPasswordReset(), { wrapper });
    result.current.mutate({ email: "testuser_003@example.com" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ securityQuestion: "好きな食べ物は？" });
  });

  it("失敗すると isError になる", async () => {
    mockRequest.mockRejectedValue(new Error("404"));

    const { result } = await renderHook(() => useRequestPasswordReset(), { wrapper });
    result.current.mutate({ email: "testuser_003@example.com" });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useConfirmPasswordReset", () => {
  it("成功する", async () => {
    mockConfirm.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useConfirmPasswordReset(), { wrapper });
    result.current.mutate({
      email: "testuser_003@example.com",
      securityAnswer: "ラーメン",
      newPassword: "NewTestPass456!",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("失敗すると isError になる", async () => {
    mockConfirm.mockRejectedValue(new Error("429"));

    const { result } = await renderHook(() => useConfirmPasswordReset(), { wrapper });
    result.current.mutate({
      email: "testuser_003@example.com",
      securityAnswer: "ちがう答え",
      newPassword: "NewTestPass456!",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
