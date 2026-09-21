/**
 * アカウント設定画面のテスト（Issue #242）。
 *
 * この画面テストでは API 関数をモックする。**403 でログアウトしないこと（認証ミドルウェアの
 * 振る舞い）は `src/features/account/api.msw.test.ts` で実クライアントを通して確かめている。**
 * ここで見るのは、画面の入力・送信・エラーの出し分け。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { AccountSettingsScreen } from "../AccountSettingsScreen";
import { changeSecurityQuestion } from "@/features/account/api";
import { ApiError } from "@/features/auth/api";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));

jest.mock("@/features/account/api", () => ({
  changeSecurityQuestion: jest.fn(),
}));

const mockChange = changeSecurityQuestion as jest.MockedFunction<typeof changeSecurityQuestion>;

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return await render(<AccountSettingsScreen />, { wrapper });
}

async function fill(
  screen: Awaited<ReturnType<typeof renderScreen>>,
  values: Partial<Record<"password" | "question" | "answer" | "confirm", string>> = {},
) {
  await fireEvent.changeText(
    screen.getByTestId("account-settings-current-password"),
    values.password ?? "TestPass123!",
  );
  await fireEvent.changeText(
    screen.getByTestId("account-settings-security-question"),
    values.question ?? "初めて飼ったペットの名前は？",
  );
  await fireEvent.changeText(
    screen.getByTestId("account-settings-security-answer"),
    values.answer ?? "ポチ",
  );
  await fireEvent.changeText(
    screen.getByTestId("account-settings-security-answer-confirm"),
    values.confirm ?? values.answer ?? "ポチ",
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

it("正しく入力して送ると API を呼び、成功を出して入力欄を空にする", async () => {
  mockChange.mockResolvedValue(undefined);
  const screen = await renderScreen();
  await fill(screen);

  await fireEvent.press(screen.getByTestId("account-settings-security-submit"));

  await waitFor(() => expect(screen.getByTestId("account-settings-success")).toBeTruthy());
  expect(mockChange).toHaveBeenCalledWith({
    currentPassword: "TestPass123!",
    securityQuestion: "初めて飼ったペットの名前は？",
    securityAnswer: "ポチ",
  });
  // パスワードと答えを画面に残さない。
  for (const id of [
    "account-settings-current-password",
    "account-settings-security-question",
    "account-settings-security-answer",
    "account-settings-security-answer-confirm",
  ]) {
    expect(screen.getByTestId(id).props.value).toBe("");
  }
});

it("確認の答えが一致しなければ API を呼ばない", async () => {
  const screen = await renderScreen();
  await fill(screen, { answer: "ポチ", confirm: "タマ" });

  await fireEvent.press(screen.getByTestId("account-settings-security-submit"));

  expect(screen.getByText("答えが一致しません")).toBeTruthy();
  expect(mockChange).not.toHaveBeenCalled();
});

it("403 REAUTH_FAILED は現在のパスワード欄の下に出す", async () => {
  mockChange.mockRejectedValue(
    new ApiError("現在のパスワードが正しくありません", "REAUTH_FAILED", 403),
  );
  const screen = await renderScreen();
  await fill(screen, { password: "WrongPass1!" });

  await fireEvent.press(screen.getByTestId("account-settings-security-submit"));

  await waitFor(() => expect(screen.getByText("現在のパスワードが正しくありません")).toBeTruthy());
  // 画面全体のエラーではなく欄のエラーとして出す。
  expect(screen.queryByTestId("account-settings-error")).toBeNull();
});

it.each([
  [
    new ApiError("x", "TOO_MANY_REQUESTS", 429),
    "試行回数が上限に達しました。しばらくしてからお試しください",
  ],
  [new ApiError("x", "VALIDATION_ERROR", 400), "入力内容を確認してください"],
  [new ApiError("x", "FORBIDDEN", 403), "通信エラー。もう一度お試しください"],
  [new Error("network"), "通信エラー。もう一度お試しください"],
])("エラー %# の文言を出す", async (error, message) => {
  mockChange.mockRejectedValue(error);
  const screen = await renderScreen();
  await fill(screen);

  await fireEvent.press(screen.getByTestId("account-settings-security-submit"));

  await waitFor(() =>
    expect(screen.getByTestId("account-settings-error").props.children).toBe(message),
  );
});

it("送信中はボタンを押せない", async () => {
  let resolve: () => void = () => {};
  mockChange.mockReturnValue(new Promise<void>((r) => (resolve = r)));
  const screen = await renderScreen();
  await fill(screen);

  await fireEvent.press(screen.getByTestId("account-settings-security-submit"));

  await waitFor(() => expect(screen.getByText("変更中…")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("account-settings-security-submit"));
  expect(mockChange).toHaveBeenCalledTimes(1);
  resolve();
  await waitFor(() => expect(screen.getByTestId("account-settings-success")).toBeTruthy());
});

it("戻るで前の画面へ。戻り先が無ければマイページへ", async () => {
  const screen = await renderScreen();
  await fireEvent.press(screen.getByTestId("account-settings-back"));
  expect(mockBack).toHaveBeenCalled();

  mockCanGoBack = false;
  await fireEvent.press(screen.getByTestId("account-settings-back"));
  expect(mockReplace).toHaveBeenCalledWith("/my-page");
});
