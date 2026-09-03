// Jest（テストランナー）の設定。
// - preset "jest-expo": Expo / React Native 用のトランスフォーム設定
// - coverageThreshold: 行・分岐カバレッジの下限。割ると CI が失敗する（testing.md §3）
//
// ※ MSW（API モック）は jest-expo の react-native 実行環境と相性が悪い
//   （msw が exports で "react-native": null を宣言している）。Phase 0 は
//   API クライアント（src/api/client）を jest.mock で差し替える方式にする。
//   本格的な API 結合テストの MSW 化は Phase 1 で node 環境のテストとして整える。
/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/api/schema.ts", // 自動生成物は対象外
    "!src/api/client.ts", // 環境変数を読むだけの設定。テストでは常に mock する
    "!src/app/**", // 画面は Phase 1 以降で本格的にテストする
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
