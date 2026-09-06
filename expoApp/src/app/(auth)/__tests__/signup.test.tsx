/**
 * サインアップ画面のテスト（BB: パスワード不一致でAPI未呼び出し、409エラー表示）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import SignupScreen from "../signup";
import { ApiError, signup } from "@/features/auth/api";
import { useSession } from "@/store/session";

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
  return { ...actual, signup: jest.fn() };
});

const mockSignup = signup as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type GetByTestId = Awaited<ReturnType<typeof render>>["getByTestId"];

async function fillValidForm(getByTestId: GetByTestId) {
  await fireEvent.changeText(getByTestId("signup-email"), "testuser_020@example.com");
  await fireEvent.changeText(getByTestId("signup-password"), "TestPass123!");
  await fireEvent.changeText(getByTestId("signup-password-confirm"), "TestPass123!");
  await fireEvent.changeText(getByTestId("signup-display-name"), "テスト太郎");
  await fireEvent.changeText(getByTestId("signup-security-question"), "好きな食べ物は？");
  await fireEvent.changeText(getByTestId("signup-security-answer"), "ラーメン");
}

beforeEach(() => {
  mockReplace.mockClear();
  mockSignup.mockReset();
  useSession.getState().clear();
  useSession.setState({ pendingRedirect: null });
});

describe("SignupScreen", () => {
  it("すべて正しく入力すると signup を呼び、成功でホームへ遷移する", async () => {
    mockSignup.mockResolvedValue({
      user: { id: "u1", displayName: "テスト太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { getByTestId } = await render(<SignupScreen />, { wrapper });
    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("signup-submit"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(app)"));
    expect(mockSignup).toHaveBeenCalledWith({
      email: "testuser_020@example.com",
      password: "TestPass123!",
      displayName: "テスト太郎",
      securityQuestion: "好きな食べ物は？",
      securityAnswer: "ラーメン",
    });
  });

  it("pendingRedirect があれば、そこへ遷移する", async () => {
    useSession.getState().setPendingRedirect("/(app)/profile-edit");
    mockSignup.mockResolvedValue({
      user: { id: "u1", displayName: "テスト太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { getByTestId } = await render(<SignupScreen />, { wrapper });
    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("signup-submit"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(app)/profile-edit"));
  });

  it("パスワードが不一致だと、API を呼ばずにエラー表示する", async () => {
    const { getByTestId, findByText } = await render(<SignupScreen />, { wrapper });
    await fillValidForm(getByTestId);
    await fireEvent.changeText(getByTestId("signup-password-confirm"), "Different1!");
    await fireEvent.press(getByTestId("signup-submit"));

    expect(await findByText("パスワードが一致しません")).toBeTruthy();
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it("409（メール重複）はメール欄の下にエラー表示する", async () => {
    mockSignup.mockRejectedValue(new ApiError("重複", "CONFLICT", 409));

    const { getByTestId, findByText } = await render(<SignupScreen />, { wrapper });
    await fillValidForm(getByTestId);
    await fireEvent.press(getByTestId("signup-submit"));

    expect(await findByText("このメールアドレスは登録済みです")).toBeTruthy();
  });
});
