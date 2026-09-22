/**
 * アプリ情報画面のテスト（Issue #317）。
 *
 * バックエンドAPIを一切呼ばない画面であることを前提に、
 * QueryClientProvider 等のラップ無しで直接レンダーする。
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { AppInfoScreen } from "../AppInfoScreen";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));

const mockGetCurrentAppVersion = jest.fn();
const mockOpenReleasePage = jest.fn();

jest.mock("@/features/appUpdate/config", () => ({
  getCurrentAppVersion: () => mockGetCurrentAppVersion(),
  getLatestReleaseUrl: () => "https://github.com/owner/repo/releases/latest",
}));
jest.mock("@/features/appUpdate/openExternal", () => ({
  openReleasePage: (url: string) => mockOpenReleasePage(url),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack = true;
  mockGetCurrentAppVersion.mockReset();
  mockOpenReleasePage.mockReset();
});

describe("AppInfoScreen", () => {
  it("現在のバージョンを表示する", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    const { findByTestId } = await render(<AppInfoScreen />);
    expect((await findByTestId("app-info-version")).props.children).toBe("バージョン 1.0.0");
  });

  it("バージョン取得中は確認中の文言を出す", async () => {
    mockGetCurrentAppVersion.mockReturnValue(new Promise(() => undefined));
    const { getByTestId } = await render(<AppInfoScreen />);
    expect(getByTestId("app-info-version").props.children).toBe("バージョンを確認中…");
  });

  it("「リリース内容を見る」で正しいURLを外部ブラウザで開く", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockOpenReleasePage.mockResolvedValue({ ok: true });
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-view-release"));
    await waitFor(() =>
      expect(mockOpenReleasePage).toHaveBeenCalledWith(
        "https://github.com/owner/repo/releases/latest",
      ),
    );
  });

  it("開けなかったらエラーを表示する（クラッシュしない）", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockOpenReleasePage.mockResolvedValue({ ok: false });
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-view-release"));
    expect(await findByTestId("app-info-open-error")).toBeTruthy();
  });

  it("「更新を確認」ボタンはStage1では非活性", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    const { findByTestId } = await render(<AppInfoScreen />);
    expect((await findByTestId("app-info-check-update")).props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it("戻れるときは戻り、戻れないときはログイン画面へ置き換える", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockCanGoBack = false;
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-back"));
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    expect(mockBack).not.toHaveBeenCalled();
  });
});
