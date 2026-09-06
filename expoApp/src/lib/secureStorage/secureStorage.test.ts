/**
 * secureStorage の実行環境判定（index.ts）の単体テスト。
 *
 * 各プラットフォーム別実装は jest.mock で差し替え、
 * 「どの環境でどの実装が選ばれるか」だけを検証する
 * （expo-secure-store や Tauri プラグイン自体の動作はここではテストしない）。
 *
 * `Platform.OS` は書き込み可能なプロパティなので、`react-native` モジュール
 * 自体を丸ごとモックする（React Native の内部依存関係が壊れて別のエラーに
 * なりやすい）のではなく、直接代入して切り替える。`index.ts` は import
 * した瞬間に判定するため、テストごとに `jest.resetModules()` してから
 * `require()` し直す必要があり、このファイルに限って
 * `no-require-imports` を無効化する（Prettier の折り返しで
 * `eslint-disable-next-line` がずれるため、ブロック全体で無効化する）。
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { Platform } from "react-native";

const originalOS = Platform.OS;

describe("secureStorage（実行環境ごとの出し分け）", () => {
  afterEach(() => {
    Platform.OS = originalOS;
    jest.resetModules();
    jest.dontMock("../tauriEnv");
  });

  it("iOS/Android（Platform.OS !== 'web'）では native 実装を使う", () => {
    Platform.OS = "ios";
    const { secureStorage } = require("./index") as typeof import("./index");
    const { nativeSecureStorage } =
      require("./secureStorage.native") as typeof import("./secureStorage.native");
    expect(secureStorage).toBe(nativeSecureStorage);
  });

  it("Web かつ Tauri なら tauri 実装を使う", () => {
    Platform.OS = "web";
    jest.doMock("../tauriEnv", () => ({ isTauri: () => true }));
    const { secureStorage } = require("./index") as typeof import("./index");
    const { tauriSecureStorage } =
      require("./secureStorage.tauri") as typeof import("./secureStorage.tauri");
    expect(secureStorage).toBe(tauriSecureStorage);
  });

  it("Web かつ非Tauri（ブラウザ単体）なら unsupported 実装を使う", () => {
    Platform.OS = "web";
    jest.doMock("../tauriEnv", () => ({ isTauri: () => false }));
    const { secureStorage } = require("./index") as typeof import("./index");
    const { unsupportedSecureStorage } =
      require("./secureStorage.unsupported") as typeof import("./secureStorage.unsupported");
    expect(secureStorage).toBe(unsupportedSecureStorage);
  });
});
