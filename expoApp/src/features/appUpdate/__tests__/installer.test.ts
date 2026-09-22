import { Platform } from "react-native";

import { startInstall } from "../installer";
import type { ReleaseInfo } from "../types";

const mockIsTauri = jest.fn();
const mockOpenReleasePage = jest.fn();
const mockGetLatestReleaseUrl = jest.fn();

jest.mock("@/lib/tauriEnv", () => ({ isTauri: () => mockIsTauri() }));
jest.mock("../openExternal", () => ({
  openReleasePage: (url: string) => mockOpenReleasePage(url),
}));
jest.mock("../config", () => ({ getLatestReleaseUrl: () => mockGetLatestReleaseUrl() }));

function makeRelease(overrides: Partial<ReleaseInfo["assets"]> = {}): ReleaseInfo {
  return {
    version: "1.2.3",
    title: "v1.2.3",
    publishedAt: "2026-01-01T00:00:00Z",
    bodyUrl: "https://github.com/owner/repo/releases/tag/v1.2.3",
    assets: { ...overrides },
  };
}

beforeEach(() => {
  mockIsTauri.mockReset();
  mockIsTauri.mockReturnValue(false);
  mockOpenReleasePage.mockReset();
  mockOpenReleasePage.mockResolvedValue({ ok: true });
  mockGetLatestReleaseUrl.mockReset();
  mockGetLatestReleaseUrl.mockReturnValue("https://github.com/owner/repo/releases/latest");
  Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
});

describe("startInstall", () => {
  it("Tauriではmsi配布URLを開く", async () => {
    mockIsTauri.mockReturnValue(true);
    const release = makeRelease({ msiUrl: "https://example.com/app.msi" });
    await startInstall(release);
    expect(mockOpenReleasePage).toHaveBeenCalledWith("https://example.com/app.msi");
  });

  it("Tauriでmsi配布URLが無ければReleaseページへフォールバックする", async () => {
    mockIsTauri.mockReturnValue(true);
    const release = makeRelease();
    await startInstall(release);
    expect(mockOpenReleasePage).toHaveBeenCalledWith(release.bodyUrl);
  });

  it("Androidではapk配布URLを開く", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const release = makeRelease({ apkUrl: "https://example.com/app.apk" });
    await startInstall(release);
    expect(mockOpenReleasePage).toHaveBeenCalledWith("https://example.com/app.apk");
  });

  it("Androidでapk配布URLが無ければReleaseページへフォールバックする", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const release = makeRelease();
    await startInstall(release);
    expect(mockOpenReleasePage).toHaveBeenCalledWith(release.bodyUrl);
  });

  it("Webでは常にReleaseページを開く", async () => {
    const release = makeRelease({
      msiUrl: "https://example.com/app.msi",
      apkUrl: "https://example.com/app.apk",
    });
    await startInstall(release);
    expect(mockOpenReleasePage).toHaveBeenCalledWith(release.bodyUrl);
  });

  it("bodyUrlも無ければgetLatestReleaseUrl()にフォールバックする", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const release = { ...makeRelease(), bodyUrl: "" };
    await startInstall(release);
    expect(mockOpenReleasePage).toHaveBeenCalledWith(
      "https://github.com/owner/repo/releases/latest",
    );
  });

  it("URL起動が失敗したらokをfalseで返す（クラッシュしない）", async () => {
    mockOpenReleasePage.mockResolvedValue({ ok: false });
    const result = await startInstall(makeRelease());
    expect(result).toEqual({ ok: false });
  });
});
