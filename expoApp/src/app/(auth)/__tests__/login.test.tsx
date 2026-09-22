/**
 * ログイン画面のテスト（BB: フォーム入力→送信、401時のエラー表示）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import LoginScreen from "../login";
import { ApiError, login, reactivate } from "@/features/auth/api";
import { useSession } from "@/store/session";

const mockReplace = jest.fn();
const mockSetParams = jest.fn();
// 画面を開いたときの URL パラメータ（再設定の成功は `reset=done`）。テストごとに差し替える。
let mockParams: { reset?: string } = {};

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    useRouter: () => ({ replace: mockReplace, setParams: mockSetParams }),
    useLocalSearchParams: () => mockParams,
    Link: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
  };
});
jest.mock("@/features/auth/api", () => {
  const actual = jest.requireActual<typeof import("@/features/auth/api")>("@/features/auth/api");
  return { ...actual, login: jest.fn(), reactivate: jest.fn() };
});

const mockLogin = login as jest.Mock;
const mockReactivate = reactivate as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockParams = {};
  mockSetParams.mockClear();
  mockReplace.mockClear();
  mockLogin.mockReset();
  mockReactivate.mockReset();
  useSession.getState().clear();
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

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
    expect(mockLogin).toHaveBeenCalledWith({
      email: "testuser_010@example.com",
      password: "TestPass123!",
      rememberMe: false,
    });
  });

  it("ディープリンク経由でも、ログイン成功後は常にホームへ遷移する（Issue #53）", async () => {
    mockLogin.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { getByTestId } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "TestPass123!");
    await fireEvent.press(getByTestId("login-submit"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
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

  it("入力不備はAPIを呼ばず、項目別に表示する", async () => {
    const { getByTestId, findByText } = await render(<LoginScreen />, { wrapper });
    await fireEvent.press(getByTestId("login-submit"));

    expect(mockLogin).not.toHaveBeenCalled();
    expect(await findByText("メールアドレスを入力してください")).toBeTruthy();
    expect(await findByText("パスワードを入力してください")).toBeTruthy();
  });

  it("それ以外のエラーは通信エラー文言を表示する", async () => {
    mockLogin.mockRejectedValue(new Error("network down"));

    const { getByTestId, findByText } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "TestPass123!");
    await fireEvent.press(getByTestId("login-submit"));

    expect(await findByText("通信エラー。もう一度お試しください")).toBeTruthy();
  });

  describe("パスワード再設定の成功スナックバー（Issue #149）", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("reset=done で開くとスナックバーを出し、パラメータを消して 3 秒で閉じる", async () => {
      jest.useFakeTimers();
      mockParams = { reset: "done" };

      const { getByTestId, queryByTestId } = await render(<LoginScreen />, { wrapper });

      expect(getByTestId("login-reset-success-snackbar")).toBeTruthy();
      expect(mockSetParams).toHaveBeenCalledWith({ reset: undefined });

      await act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(queryByTestId("login-reset-success-snackbar")).toBeNull();
    });

    it("パラメータ無しで開いたときは出さない", async () => {
      const { queryByTestId } = await render(<LoginScreen />, { wrapper });

      expect(queryByTestId("login-reset-success-snackbar")).toBeNull();
      expect(mockSetParams).not.toHaveBeenCalled();
    });
  });

  it("退会済みアカウントは確認後に再開してホームへ遷移する", async () => {
    mockLogin.mockRejectedValue(new ApiError("アカウントは退会中です", "ACCOUNT_DEACTIVATED", 409));
    mockReactivate.mockResolvedValue({
      user: { id: "u1", displayName: "太郎" },
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });

    const { getByTestId, findByTestId } = await render(<LoginScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("login-email"), "testuser_010@example.com");
    await fireEvent.changeText(getByTestId("login-password"), "TestPass123!");
    await fireEvent.press(getByTestId("login-submit"));
    await fireEvent.press(await findByTestId("account-reactivate-dialog-confirm"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
    expect(mockReactivate).toHaveBeenCalledWith({
      email: "testuser_010@example.com",
      password: "TestPass123!",
      rememberMe: false,
    });
  });

  it("「アプリ情報」への導線を出す（Issue #317）", async () => {
    const { findByText } = await render(<LoginScreen />, { wrapper });
    expect(await findByText("アプリ情報")).toBeTruthy();
  });
});
