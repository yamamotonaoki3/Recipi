/**
 * Appium + WebdriverIO（Android エミュレータ）の E2E テスト設定（Issue #36）。
 *
 * Maestro は Web 版で入力欄のフォーカス取りこぼしが再現性100%で起き、
 * Android 版でも特定の欄間（秘密の質問→答え）で同系統の不具合が再現した。
 * 4種類の回避策（待機延長・DOM安定待ち・入力経路のウォームアップ・
 * 連続tapOn）を試しても解消しなかったため、Android 版の E2E も Appium +
 * WebdriverIO に置き換えた（Detox は Expo SDK 57 に対応する config-plugin
 * が無く、SDK 互換性リスクがあるため見送った）。詳細は
 * docs/lessons-learned.md の該当エントリ参照。
 *
 * Appium は「ブラックボックス」型（ビルド済み .apk を UiAutomator2
 * 経由で OS レベルから操作する）ため、Expo / React Native のバージョンに
 * 依存しない。
 *
 * CI（.github/workflows/e2e.yml）では reactivecircus/android-emulator-runner
 * で起動したエミュレータに対して実行する。EXPO_PUBLIC_API_BASE_URL は
 * ビルド時（gradle タスク実行時）に埋め込まれる。
 */
// `autoCompileOpts` は @wdio/cli 側の設定型拡張であり、
// @wdio/types の Options.Testrunner には含まれないため、型注釈は付けない
// （wdio 自体は実行時に CommonJS 経由でこのオブジェクトを読むだけで、
// 型注釈が無くても動作に影響しない）。
export const config = {
  runner: "local",
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      transpileOnly: true,
      // e2e/android 専用の tsconfig（mocha の型を使う。メインの
      // tsconfig.json は jest 用のグローバル型と衝突するため分けている）。
      project: "./e2e/android/tsconfig.json",
    },
  },

  specs: ["./e2e/android/**/*.e2e.ts"],
  maxInstances: 1,

  hostname: "127.0.0.1",
  port: 4723,
  path: "/",

  capabilities: [
    {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:app": "./android/app/build/outputs/apk/release/app-release.apk",
      "appium:appPackage": "com.recipi.app",
      "appium:appWaitActivity": "*",
      "appium:noReset": false,
      "appium:newCommandTimeout": 240,
    },
  ],

  logLevel: "info",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },

  // 失敗時に画面構造（page source）とスクリーンショットを残す。
  // signup-email 等が resource-id で見つからない不具合の原因切り分け用
  // （React Native の New Architecture 下では testID が resource-id に
  // 期待通り反映されない可能性がある。docs/lessons-learned.md 参照）。
  afterTest: async function (
    _test: unknown,
    _context: unknown,
    result: { passed: boolean },
  ) {
    if (result.passed) return;
    const fs = await import("node:fs/promises");
    await fs.mkdir("./wdio-debug", { recursive: true });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source: string = await (globalThis as any).browser.getPageSource();
      await fs.writeFile("./wdio-debug/page-source.xml", source, "utf-8");
    } catch {
      // 取得自体に失敗しても後続の後片付けは継続する。
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (globalThis as any).browser.saveScreenshot("./wdio-debug/screenshot.png");
    } catch {
      // 同上。
    }
  },
};
