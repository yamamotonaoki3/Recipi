/**
 * ログイン画面のテスト（BB: フォーム入力→送信、401時のエラー表示）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import LoginScreen from "../login";
import { ApiError, login } from "@/features/auth/api";
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
  return { ...actual, login: jest.fn() };
});

const mockLogin = login as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockReplace.mockClear();
  mockLogin.mockReset();
  useSession.getState().clear();
  useSession.setState({ pendingRedirect: null });
});

describe("LoginScreen", () => {
  it("メール・パスワードを入力して送信すると、成功時にホームへ遷移する", async () => {
    mockLogin.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { getByTestId } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "TestPass123!");
    await fireEvent.press(getByTestId("login-submit"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(app)"));
    expect(mockLogin).toHaveBeenCalledWith({
      email: "testuser_010@example.com",
      password: "TestPass123!",
      rememberMe: false,
    });
  });

  it("pendingRedirect があれば、そこへ遷移する", async () => {
    useSession.getState().setPendingRedirect("/(app)/profile-edit");
    mockLogin.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { getByTestId } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "TestPass123!");
    await fireEvent.press(getByTestId("login-submit"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(app)/profile-edit"));
  });

  it("401 エラーは固定文言を表示する", async () => {
    mockLogin.mockRejectedValue(
      new ApiError("メールアドレスまたはパスワードが正しくありません", "UNAUTHORIZED", 401),
    );

    const { getByTestId, findByText } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "WrongPass123!");
    await fireEvent.press(getByTestId("login-submit"));

    expect(await findByText("メールアドレスまたはパスワードが違います")).toBeTruthy();
  });

  it("それ以外のエラーは通信エラー文言を表示する", async () => {
    mockLogin.mockRejectedValue(new Error("network down"));

    const { getByTestId, findByText } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "TestPass123!");
    await fireEvent.press(getByTestId("login-submit"));

    expect(await findByText("通信エラー。もう一度お試しください")).toBeTruthy();
  });
});
