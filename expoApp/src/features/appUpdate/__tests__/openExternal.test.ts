import { openReleasePage } from "../openExternal";

const mockIsTauri = jest.fn();
const mockOpenUrl = jest.fn();
const mockLinkingOpenURL = jest.fn();

jest.mock("@/lib/tauriEnv", () => ({ isTauri: () => mockIsTauri() }));
jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));
jest.mock("react-native", () => ({
  Linking: { openURL: (...args: unknown[]) => mockLinkingOpenURL(...args) },
}));

beforeEach(() => {
  mockIsTauri.mockReset();
  mockOpenUrl.mockReset();
  mockLinkingOpenURL.mockReset();
});

describe("openExternal", () => {
  it("Tauriでは@tauri-apps/plugin-openerのopenUrl()を使う", async () => {
    mockIsTauri.mockReturnValue(true);
    mockOpenUrl.mockResolvedValue(undefined);
    await expect(openReleasePage("https://example.com")).resolves.toEqual({ ok: true });
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com");
    expect(mockLinkingOpenURL).not.toHaveBeenCalled();
  });

  it("Tauri以外ではLinking.openURLを使う", async () => {
    mockIsTauri.mockReturnValue(false);
    mockLinkingOpenURL.mockResolvedValue(undefined);
    await expect(openReleasePage("https://example.com")).resolves.toEqual({ ok: true });
    expect(mockLinkingOpenURL).toHaveBeenCalledWith("https://example.com");
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("起動に失敗したらokをfalseで返す（例外を投げない）", async () => {
    mockIsTauri.mockReturnValue(false);
    mockLinkingOpenURL.mockRejectedValue(new Error("boom"));
    await expect(openReleasePage("https://example.com")).resolves.toEqual({ ok: false });
  });

  it("Tauriでの起動失敗もokをfalseで返す", async () => {
    mockIsTauri.mockReturnValue(true);
    mockOpenUrl.mockRejectedValue(new Error("boom"));
    await expect(openReleasePage("https://example.com")).resolves.toEqual({ ok: false });
  });
});
