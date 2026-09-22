import {
  getCurrentAppVersion,
  getGithubOwner,
  getGithubRepo,
  getLatestReleaseUrl,
  getReleasesApiUrl,
} from "../config";

const mockIsTauri = jest.fn();
const mockGetTauriVersion = jest.fn();

jest.mock("@/lib/tauriEnv", () => ({ isTauri: () => mockIsTauri() }));
jest.mock("@tauri-apps/api/app", () => ({ getVersion: () => mockGetTauriVersion() }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0" } },
}));

beforeEach(() => {
  mockIsTauri.mockReset();
  mockGetTauriVersion.mockReset();
});

// EXPO_PUBLIC_* は babel-preset-expo によりビルド時（jest実行時も含む）に
// 静的インライン化されるため、テスト内で process.env を書き換えても
// 反映されない（既存の client.ts も同じ理由で環境変数の値ごとの分岐テストは
// 書いていない）。ここではフォールバック定数を含む組み立てロジックのみ検証する。
describe("appUpdate/config", () => {
  it("owner/repoからRelease詳細ページのURLを組み立てる", () => {
    expect(getLatestReleaseUrl()).toBe(
      `https://github.com/${getGithubOwner()}/${getGithubRepo()}/releases/latest`,
    );
  });

  it("owner/repoからRelease APIのURLを組み立てる", () => {
    expect(getReleasesApiUrl()).toBe(
      `https://api.github.com/repos/${getGithubOwner()}/${getGithubRepo()}/releases/latest`,
    );
  });

  it("Tauriでは@tauri-apps/apiのgetVersion()を使う", async () => {
    mockIsTauri.mockReturnValue(true);
    mockGetTauriVersion.mockResolvedValue("1.2.3");
    await expect(getCurrentAppVersion()).resolves.toBe("1.2.3");
  });

  it("TauriでgetVersion()が失敗したらexpo-constantsにフォールバックする", async () => {
    mockIsTauri.mockReturnValue(true);
    mockGetTauriVersion.mockRejectedValue(new Error("boom"));
    await expect(getCurrentAppVersion()).resolves.toBe("1.0.0");
  });

  it("Tauri以外ではexpo-constantsのバージョンを使う", async () => {
    mockIsTauri.mockReturnValue(false);
    await expect(getCurrentAppVersion()).resolves.toBe("1.0.0");
    expect(mockGetTauriVersion).not.toHaveBeenCalled();
  });
});
