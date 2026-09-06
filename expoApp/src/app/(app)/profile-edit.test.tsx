/**
 * プロフィール編集画面のテスト（BB: 文字数境界、保存成功で戻る）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import ProfileEditScreen from "./profile-edit";
import { updateMe } from "@/features/auth/api";
import { useSession } from "@/store/session";

const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));
jest.mock("@/features/auth/api", () => ({ updateMe: jest.fn() }));

const mockUpdateMe = updateMe as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockBack.mockClear();
  mockUpdateMe.mockReset();
  useSession.getState().clear();
  useSession.setState({ user: { id: "u1", displayName: "旧名前" } });
});

describe("ProfileEditScreen", () => {
  it("現在の表示名を初期値として表示する", async () => {
    const { getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    expect(getByTestId("profile-edit-display-name").props.value).toBe("旧名前");
  });

  it("マウント時点で user が無くても、復元後に表示名を反映する（保護ルートへの直接ディープリンク）", async () => {
    useSession.setState({ user: null });

    const { getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    expect(getByTestId("profile-edit-display-name").props.value).toBe("");

    useSession.setState({ user: { id: "u1", displayName: "復元された名前" } });

    await waitFor(() =>
      expect(getByTestId("profile-edit-display-name").props.value).toBe("復元された名前"),
    );
  });

  it("入力を始めた後に user が更新されても、入力中の値は上書きしない", async () => {
    const { getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "入力中の名前");

    useSession.setState({ user: { id: "u1", displayName: "サーバー側の別の名前" } });

    expect(getByTestId("profile-edit-display-name").props.value).toBe("入力中の名前");
  });

  it("空文字だと保存をブロックする", async () => {
    const { getByTestId, findByText } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "");
    await fireEvent.press(getByTestId("profile-edit-save"));

    expect(await findByText("表示名を入力してください")).toBeTruthy();
    expect(mockUpdateMe).not.toHaveBeenCalled();
  });

  it("31文字だと保存をブロックする", async () => {
    const { getByTestId, findByText } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "あ".repeat(31));
    await fireEvent.press(getByTestId("profile-edit-save"));

    expect(await findByText("表示名は30文字以内で入力してください")).toBeTruthy();
    expect(mockUpdateMe).not.toHaveBeenCalled();
  });

  it("保存に成功すると前の画面に戻る", async () => {
    mockUpdateMe.mockResolvedValue({ id: "u1", email: "a@example.com", displayName: "新名前" });

    const { getByTestId } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "新名前");
    await fireEvent.press(getByTestId("profile-edit-save"));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockUpdateMe).toHaveBeenCalledWith({ displayName: "新名前" });
  });

  it("保存が失敗するとエラーを表示する", async () => {
    mockUpdateMe.mockRejectedValue(new Error("network error"));

    const { getByTestId, findByText } = await render(<ProfileEditScreen />, { wrapper });
    await fireEvent.changeText(getByTestId("profile-edit-display-name"), "新名前");
    await fireEvent.press(getByTestId("profile-edit-save"));

    expect(await findByText("保存に失敗しました")).toBeTruthy();
  });
});
