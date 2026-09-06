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
/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: "react-native",
      preset: "jest-expo",
      testPathIgnorePatterns: ["/node_modules/", "\\.msw\\.test\\.ts$"],
      // `_layout.tsx` が読み込む `global.css`（NativeWind / Tailwind の
      // `@tailwind` ディレクティブ）は jest の変換対象外なので、
      // テストでは中身を見ない空モジュールに差し替える。
      moduleNameMapper: {
        "\\.css$": "<rootDir>/jest.cssMock.js",
      },
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
      lines: 60,
      branches: 50,
    },
  },
  // TanStack Query のタイマーなどで「Jest did not exit」警告が出ることがある。
  // scaffold では強制終了で十分（テスト自体は通っている）。
  forceExit: true,
};
