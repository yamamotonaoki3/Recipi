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
const mockCheckForUpdate = jest.fn();
const mockStartInstall = jest.fn();

jest.mock("@/features/appUpdate/config", () => ({
  getCurrentAppVersion: () => mockGetCurrentAppVersion(),
  getLatestReleaseUrl: () => "https://github.com/owner/repo/releases/latest",
}));
jest.mock("@/features/appUpdate/openExternal", () => ({
  openReleasePage: (url: string) => mockOpenReleasePage(url),
}));
jest.mock("@/features/appUpdate/api", () => ({
  checkForUpdate: () => mockCheckForUpdate(),
}));
jest.mock("@/features/appUpdate/installer", () => ({
  startInstall: (release: unknown) => mockStartInstall(release),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack = true;
  mockGetCurrentAppVersion.mockReset();
  mockOpenReleasePage.mockReset();
  mockCheckForUpdate.mockReset();
  mockStartInstall.mockReset();
  mockStartInstall.mockResolvedValue({ ok: true });
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

  it("「更新を確認」を押すと結果（最新版）を表示する（Issue #318）", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockCheckForUpdate.mockResolvedValue({ state: "upToDate" });
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-check-update"));
    expect((await findByTestId("app-info-update-state")).props.children).toEqual([
      "最新版です",
      "",
    ]);
  });

  it("「更新を確認」で新版があればバージョン付きで表示する", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockCheckForUpdate.mockResolvedValue({
      state: "updateAvailable",
      release: { version: "1.2.3" },
    });
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-check-update"));
    expect((await findByTestId("app-info-update-state")).props.children).toEqual([
      "新しいバージョンがあります",
      "（v1.2.3）",
    ]);
  });

  it("新版があるとき「更新する」ボタンを出し、押すとインストール案内を表示する（Issue #319）", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    const release = { version: "1.2.3", title: "", publishedAt: "", bodyUrl: "", assets: {} };
    mockCheckForUpdate.mockResolvedValue({ state: "updateAvailable", release });
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-check-update"));
    await fireEvent.press(await findByTestId("app-info-install-update"));
    expect(await findByTestId("install-guide-dialog")).toBeTruthy();

    await fireEvent.press(await findByTestId("install-guide-dialog-confirm"));
    expect(mockStartInstall).toHaveBeenCalledWith(release);
  });

  it("最新版のときは「更新する」ボタンを出さない", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockCheckForUpdate.mockResolvedValue({ state: "upToDate" });
    const { findByTestId, queryByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-check-update"));
    await findByTestId("app-info-update-state");
    expect(queryByTestId("app-info-install-update")).toBeNull();
  });

  it("確認に失敗しても結果を表示する（クラッシュしない）", async () => {
    mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
    mockCheckForUpdate.mockResolvedValue({ state: "checkFailed" });
    const { findByTestId } = await render(<AppInfoScreen />);
    await fireEvent.press(await findByTestId("app-info-check-update"));
    expect((await findByTestId("app-info-update-state")).props.children).toEqual([
      "確認できませんでした",
      "",
    ]);
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
