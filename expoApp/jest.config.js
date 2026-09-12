// Jest（テストランナー）の設定。
//
// Issue #36 から `projects` で2種類のテスト環境を使い分けている:
// - "react-native"（既存）: jest-expo preset。コンポーネント/hook の単体テスト。
//   API クライアント（src/api/client）は jest.mock で丸ごと差し替える方式
//   （MSW は jest-expo の RN 実行環境と相性が悪く動かないため。理由は下記）。
// - "node"（新規）: client.ts / refreshCoordinator.ts のような「実際の
//   fetch 通信の挙動」を検証したいテストを、MSW（Mock Service Worker）で
//   ネットワークレベルからモックして行う。`*.msw.test.ts` という名前の
//   ファイルだけをこちらで実行する。
//
// なぜ2つに分けるか: client.ts に実装する「401 を受けたらリフレッシュして
// リトライする」というミドルウェアは、`jest.mock("./client")` で client.ts
// 自体を差し替えてしまうとテストしたい対象そのものが消えてしまう。
// MSW は実際の fetch をネットワークレベルで横取りするので、この手の
// 通信の分岐を本物に近い形で検証できる。
//
// coverageThreshold: 行・分岐カバレッジの下限。割ると CI が失敗する（testing.md §3）。
// MVP 完成時の目標値（行 75% / 分岐 65%）。Issue #76 で Phase 1 開始時の値から引き上げた。
// `npm test` だけではカバレッジを計測しないので判定されない。CI と同じ `npm test -- --coverage` で確かめる。
/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: "react-native",
      preset: "jest-expo",
      // e2e/ は Playwright（*.spec.ts）と WebdriverIO（*.e2e.ts）が使う
      // ディレクトリで、jest の対象ではない（jest のデフォルト testMatch は
      // *.spec.ts も拾ってしまうため明示的に除外する）。
      testPathIgnorePatterns: ["/node_modules/", "\\.msw\\.test\\.ts$", "<rootDir>/e2e/"],
      // `_layout.tsx` が読み込む `global.css`（NativeWind / Tailwind の
      // `@tailwind` ディレクティブ）は jest の変換対象外なので、
      // テストでは中身を見ない空モジュールに差し替える。
      moduleNameMapper: {
        "\\.css$": "<rootDir>/jest.cssMock.js",
      },
      // SafeArea（`useSafeAreaInsets`）のモック。理由は jest.setup.js のコメント。
      setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
    },
    {
      displayName: "node",
      testEnvironment: "node",
      testMatch: ["<rootDir>/src/**/*.msw.test.ts"],
      transform: {
        "^.+\\.[tj]sx?$": ["babel-jest", { presets: ["babel-preset-expo"] }],
        "^.+\\.mjs$": ["babel-jest", { presets: ["babel-preset-expo"] }],
      },
      // msw とその依存（rettime, @open-draft/* 等）は ESM のみで配布されて
      // いるパッケージが多く、個別に列挙するとキリが無いため node_modules を
      // 一律 transform 対象外にするデフォルトを外す（node 環境の小さな
      // テストプロジェクトなのでビルド時間への影響は無視できる）。
      transformIgnorePatterns: [],
    },
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/api/schema.ts", // 自動生成物は対象外
    "!src/**/*.test.{ts,tsx}", // テストファイル自体は対象外
    "!src/**/*.msw.test.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 75,
      branches: 65,
    },
  },
  // 1 テストの制限時間。
  //
  // 既定の 5 秒だと、CI の遅いランナーでファイル内の最初のテストが
  // モジュール読み込みのコストを被ってタイムアウトする（RNTL v14 は
  // render / fireEvent が非同期で、画面コンポーネントの依存ツリーも大きい）。
  // ローカルは 1 テスト 1 秒未満で終わるので、「本当に固まっている」ケースを
  // 検出する余裕は残したまま引き上げる。
  //
  // **`projects[]` の中に書いても効かない**（Jest はプロジェクト単位の
  // `testTimeout` を無視し、既定の 5000ms のままになる）。6 秒待つだけの
  // テストが 5000ms で落ちることで確認したうえで、ルート側に置いている。
  testTimeout: 20_000,
  // TanStack Query のタイマーなどで「Jest did not exit」警告が出ることがある。
  // scaffold では強制終了で十分（テスト自体は通っている）。
  forceExit: true,
};
