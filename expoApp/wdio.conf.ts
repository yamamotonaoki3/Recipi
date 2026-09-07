/**
 * Appium + WebdriverIO（Android エミュレータ）の E2E テスト設定（Issue #36）。
 *
 * Maestro は Web 版で入力欄のフォーカス取りこぼしが再現性100%で起きたため、
 * Web を Playwright、Android を Appium + WebdriverIO に置き換えた
 * （Detox は Expo SDK 57 対応の config-plugin が無く見送り）。詳細は
 * docs/lessons-learned.md の該当エントリ参照。
 *
 * Appium は「ブラックボックス」型（ビルド済み .apk を UiAutomator2
 * 経由で OS レベルから操作する）ため、Expo / React Native のバージョンに
 * 依存しない。
 *
 * CI（.github/workflows/e2e-android.yml）では
 * reactivecircus/android-emulator-runner で起動したエミュレータに対して
 * 実行する。EXPO_PUBLIC_API_BASE_URL はビルド時（gradle タスク実行時）に
 * 埋め込まれる。
 *
 * 【`appium:disableIdLocatorAutocompletion` について（Issue #57）】
 * React Native の New Architecture は `testID` を Android の `resource-id`
 * に「パッケージ接頭辞なし」（`signup-email` のように値そのまま）で流す。
 * 一方 Appium の `id` ロケータ戦略は既定で「補完」が働き、`signup-email`
 * → `com.recipi.app:id/signup-email` に変換してから探すため、素の
 * resource-id にマッチせず即 404 になる（`getPageSource` では見えるのに
 * `findElement` が失敗する、という症状の正体。当初は「ドライバの深い
 * 不具合」と誤診断していた）。この補完を切ると `id=signup-email` が
 * 素の resource-id を正しく引く。
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
      // `noReset: false` = 「リセットする」。spec ファイルごとに別の Appium
      // セッションが張られ、その開始時に `adb shell pm clear` でアプリの
      // データ（＝ログイン状態やセキュアストレージ）が消える。
      // これにより spec 間は独立する（`maxInstances: 1` は同時実行数の制限で
      // あって、セッションを共有するという意味ではない）。
      // 実測: CI の 1 回の実行で Session ID が 2 つ作られ、`pm clear` も
      // 実行されている。`recipe-crud` が認証済みの状態で途中失敗した直後に
      // `signup-login-logout` が問題なく pass したことでも裏付けられている。
      "appium:noReset": false,
      "appium:newCommandTimeout": 240,
      // RN の testID は resource-id に接頭辞なしで入る（上のコメント参照）。
      // `id` ロケータのパッケージ名補完を切って素の resource-id を引かせる。
      //
      // これは capability として渡して実際に効いている（`appium:settings` に
      // 移す必要はない）。Appium サーバーログで確認済み:
      //   POST /element {"using":"id","value":"editor-save"}
      //     → proxy {"strategy":"id","selector":"editor-save"} → status 200
      // 追加前は同じリクエストが 44ms で 404 を返していた。
      "appium:disableIdLocatorAutocompletion": true,
    },
  ],

  logLevel: "info",
  bail: 0,
  // CI のエミュレータでは初回起動（コールドスタート）が既定の待機時間
  // より遅くなることがあったため、標準の 5 秒（WebdriverIO 既定値）より
  // 大きめに設定する。
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },

  // 失敗時に画面構造（page source）とスクリーンショットを残す。
  // ロケータの取り違え・遷移待ちの失敗などを CI のログだけで切り分ける用。
  afterTest: async function (_test: unknown, _context: unknown, result: { passed: boolean }) {
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
