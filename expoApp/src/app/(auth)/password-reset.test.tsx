/**
 * パスワードリセット画面のテスト（BB: 2ステップの流れ、新パスワード不一致ブロック）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import PasswordResetScreen from "./password-reset";
import { ApiError, confirmPasswordReset, requestPasswordReset } from "@/features/auth/api";

const mockReplace = jest.fn();

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    useRouter: () => ({ replace: mockReplace }),
    Link: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
  };
});
jest.mock("@/features/auth/api", () => {
  const actual = jest.requireActual<typeof import("@/features/auth/api")>("@/features/auth/api");
  return { ...actual, requestPasswordReset: jest.fn(), confirmPasswordReset: jest.fn() };
});

const mockRequest = requestPasswordReset as jest.Mock;
const mockConfirm = confirmPasswordReset as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockReplace.mockClear();
  mockRequest.mockReset();
  mockConfirm.mockReset();
});

describe("PasswordResetScreen", () => {
  it("ステップ1で質問取得に成功すると、ステップ2が表示される", async () => {
    mockRequest.mockResolvedValue({ securityQuestion: "好きな食べ物は？" });

    const { getByTestId, findByText } = await render(<PasswordResetScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("password-reset-email"), "testuser_040@example.com");
    await fireEvent.press(getByTestId("password-reset-request-submit"));

    expect(await findByText("好きな食べ物は？")).toBeTruthy();
    expect(getByTestId("password-reset-security-answer")).toBeTruthy();
  });

  it("ステップ1で404なら未登録メールのエラーを表示する", async () => {
    mockRequest.mockRejectedValue(new ApiError("未登録です", "NOT_FOUND", 404));

    const { getByTestId, findByText } = await render(<PasswordResetScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("password-reset-email"), "testuser_040@example.com");
    await fireEvent.press(getByTestId("password-reset-request-submit"));

    expect(await findByText("このメールアドレスは登録されていません")).toBeTruthy();
  });

  it("ステップ2で新パスワードが不一致だとブロックし、confirm は呼ばれない", async () => {
    mockRequest.mockResolvedValue({ securityQuestion: "好きな食べ物は？" });

    const { getByTestId, findByText } = await render(<PasswordResetScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("password-reset-email"), "testuser_040@example.com");
    await fireEvent.press(getByTestId("password-reset-request-submit"));
    await findByText("好きな食べ物は？");

    await fireEvent.changeText(getByTestId("password-reset-security-answer"), "ラーメン");
    await fireEvent.changeText(getByTestId("password-reset-new-password"), "NewTestPass456!");
    await fireEvent.changeText(getByTestId("password-reset-new-password-confirm"), "Different1!");
    await fireEvent.press(getByTestId("password-reset-confirm-submit"));

    expect(await findByText("パスワードが一致しません")).toBeTruthy();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("ステップ2の送信が成功すると、ログイン画面へ遷移する", async () => {
    mockRequest.mockResolvedValue({ securityQuestion: "好きな食べ物は？" });
    mockConfirm.mockResolvedValue(undefined);

    const { getByTestId, findByText } = await render(<PasswordResetScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("password-reset-email"), "testuser_040@example.com");
    await fireEvent.press(getByTestId("password-reset-request-submit"));
    await findByText("好きな食べ物は？");

    await fireEvent.changeText(getByTestId("password-reset-security-answer"), "ラーメン");
    await fireEvent.changeText(getByTestId("password-reset-new-password"), "NewTestPass456!");
    await fireEvent.changeText(
      getByTestId("password-reset-new-password-confirm"),
      "NewTestPass456!",
    );
    await fireEvent.press(getByTestId("password-reset-confirm-submit"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(auth)/login"));
    expect(mockConfirm).toHaveBeenCalledWith({
      email: "testuser_040@example.com",
      securityAnswer: "ラーメン",
      newPassword: "NewTestPass456!",
    });
  });

  it("ステップ2で429なら試行回数上限のエラーを表示する", async () => {
    mockRequest.mockResolvedValue({ securityQuestion: "好きな食べ物は？" });
    mockConfirm.mockRejectedValue(new ApiError("試行しすぎ", "TOO_MANY_REQUESTS", 429));

    const { getByTestId, findByText } = await render(<PasswordResetScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("password-reset-email"), "testuser_040@example.com");
    await fireEvent.press(getByTestId("password-reset-request-submit"));
    await findByText("好きな食べ物は？");

    await fireEvent.changeText(getByTestId("password-reset-security-answer"), "ちがう答え");
    await fireEvent.changeText(getByTestId("password-reset-new-password"), "NewTestPass456!");
    await fireEvent.changeText(
      getByTestId("password-reset-new-password-confirm"),
      "NewTestPass456!",
    );
    await fireEvent.press(getByTestId("password-reset-confirm-submit"));

    expect(
      await findByText("試行回数が上限に達しました。しばらくしてからお試しください"),
    ).toBeTruthy();
  });
});
