// "react-native" プロジェクト（jest-expo）の共通セットアップ。
//
// `react-native-safe-area-context` は、実機では `SafeAreaProvider` が
// ネイティブから受け取ったステータスバー / ナビゲーションバーの inset を
// コンテキスト経由で配る。単体テストでは各コンポーネントを
// `SafeAreaProvider` 無しで直接レンダリングするため、そのままだと
// `useSafeAreaInsets()` が実装を取れずに落ちる。
//
// モックは**自己完結**にして実モジュールを読み込まない（`jest.requireActual`
// を使わない）。実モジュールはネイティブ側のシムを引き連れてくるため、
// 全テストファイルの起動コストが増え、CI の遅いランナーで最初のテストが
// 既定の 5 秒タイムアウトに引っかかる原因になった。
// アプリが使うのは `SafeAreaProvider` と `useSafeAreaInsets` の 2 つだけ。
//
// inset は全て 0（＝セーフエリア無し）にして、テストの期待値が
// 端末ごとの inset に左右されないようにする。
jest.mock("react-native-safe-area-context", () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  return {
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
    // ネイティブ実装を持たないので素通しにする。
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
  };
});
