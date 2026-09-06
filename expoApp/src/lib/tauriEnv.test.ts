import { isTauri } from "./tauriEnv";

describe("isTauri", () => {
  it("@tauri-apps/api の isTauri をそのまま再エクスポートしている", () => {
    // window.__TAURI_INTERNALS__ が無いテスト環境では false になる。
    expect(isTauri()).toBe(false);
  });
});
