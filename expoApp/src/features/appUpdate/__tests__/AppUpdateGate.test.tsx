/**
 * AppUpdateGateのテスト（Issue #318）。
 *
 * 新Release検出時のバナー表示・「後で」の抑制、backend接続不能時の
 * ダイアログ/バーの出し分けを、依存（checkForUpdate/useHealth/
 * backendReachability/updateDismissal）をモックして検証する。
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { AppUpdateGate } from "../AppUpdateGate";
import { useBackendReachability } from "../backendReachability";
import { useUpdateDismissal } from "../updateDismissal";

const mockCheckForUpdate = jest.fn();
const mockOpenReleasePage = jest.fn();
const mockUseHealth = jest.fn();

jest.mock("../api", () => ({ checkForUpdate: () => mockCheckForUpdate() }));
jest.mock("../openExternal", () => ({
  openReleasePage: (url: string) => mockOpenReleasePage(url),
}));
jest.mock("../config", () => ({
  getLatestReleaseUrl: () => "https://github.com/owner/repo/releases/latest",
}));
jest.mock("@/api/health", () => ({ useHealth: () => mockUseHealth() }));

beforeEach(async () => {
  mockCheckForUpdate.mockReset();
  mockCheckForUpdate.mockResolvedValue({ state: "upToDate" });
  mockOpenReleasePage.mockReset();
  mockOpenReleasePage.mockResolvedValue({ ok: true });
  mockUseHealth.mockReset();
  mockUseHealth.mockReturnValue({ isFetching: false, refetch: jest.fn() });
  // zustandストアの更新は、同期版act()だとReact 19のuseSyncExternalStoreと
  // 噛み合わずレンダーが反映されないことがあるため、非同期版でawaitする。
  await act(async () => {
    useBackendReachability.setState({ status: "ok" });
    useUpdateDismissal.setState({ dismissedVersion: null });
  });
});

describe("AppUpdateGate", () => {
  it("新Releaseが無ければ何も表示しない", async () => {
    mockCheckForUpdate.mockResolvedValue({ state: "upToDate" });
    const { queryByTestId } = await render(<AppUpdateGate />);
    await waitFor(() => expect(mockCheckForUpdate).toHaveBeenCalled());
    expect(queryByTestId("update-notification-banner")).toBeNull();
  });

  it("新Releaseがあれば更新通知バナーを表示する", async () => {
    mockCheckForUpdate.mockResolvedValue({
      state: "updateAvailable",
      release: {
        version: "1.2.3",
        title: "v1.2.3",
        publishedAt: "2026-01-01T00:00:00Z",
        bodyUrl: "https://github.com/owner/repo/releases/tag/v1.2.3",
        assets: {},
      },
    });
    const { findByTestId } = await render(<AppUpdateGate />);
    expect(await findByTestId("update-notification-banner")).toBeTruthy();
  });

  it("「後で」を押すと同一起動中は再表示しない", async () => {
    mockCheckForUpdate.mockResolvedValue({
      state: "updateAvailable",
      release: {
        version: "1.2.3",
        title: "v1.2.3",
        publishedAt: "",
        bodyUrl: "https://example.com/release",
        assets: {},
      },
    });
    const { findByTestId, queryByTestId } = await render(<AppUpdateGate />);
    await fireEvent.press(await findByTestId("update-notification-banner-dismiss"));
    expect(queryByTestId("update-notification-banner")).toBeNull();
    expect(useUpdateDismissal.getState().dismissedVersion).toBe("1.2.3");
  });

  it("backend接続不能なら警告ダイアログを表示する", async () => {
    const { findByTestId } = await render(<AppUpdateGate />);
    await act(async () => useBackendReachability.getState().markUnreachable());
    expect(await findByTestId("connectivity-warning-dialog")).toBeTruthy();
  });

  it("「後で確認」を押すとダイアログは消えるが、警告バーが残る", async () => {
    const { findByTestId, queryByTestId } = await render(<AppUpdateGate />);
    await act(async () => useBackendReachability.getState().markUnreachable());
    await fireEvent.press(await findByTestId("connectivity-warning-dialog-dismiss"));
    expect(queryByTestId("connectivity-warning-dialog")).toBeNull();
    expect(await findByTestId("connectivity-warning-bar")).toBeTruthy();
  });

  it("「再試行」を押すとuseHealthのrefetchを呼ぶ", async () => {
    const refetch = jest.fn();
    mockUseHealth.mockReturnValue({ isFetching: false, refetch });
    const { findByTestId } = await render(<AppUpdateGate />);
    await act(async () => useBackendReachability.getState().markUnreachable());
    await fireEvent.press(await findByTestId("connectivity-warning-dialog-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("API復旧（statusがokに戻る）で警告バーも解除される", async () => {
    const { findByTestId, queryByTestId } = await render(<AppUpdateGate />);
    await act(async () => useBackendReachability.getState().markUnreachable());
    await fireEvent.press(await findByTestId("connectivity-warning-dialog-dismiss"));
    expect(await findByTestId("connectivity-warning-bar")).toBeTruthy();

    await act(async () => useBackendReachability.getState().markReachable());
    await waitFor(() => expect(queryByTestId("connectivity-warning-bar")).toBeNull());
    expect(queryByTestId("connectivity-warning-dialog")).toBeNull();
  });
});
