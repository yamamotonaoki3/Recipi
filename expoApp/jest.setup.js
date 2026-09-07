// "react-native" プロジェクト（jest-expo）の共通セットアップ。
//
// `react-native-safe-area-context` は、実機では `SafeAreaProvider` が
// ネイティブから受け取ったステータスバー / ナビゲーションバーの inset を
// コンテキスト経由で配る。単体テストでは各コンポーネントを
// `SafeAreaProvider` 無しで直接レンダリングするため、そのままだと
// `useSafeAreaInsets()` が実装を取れずに落ちる。
//
// ライブラリ同梱のモック（`react-native-safe-area-context/jest/mock`）は
// `export default` かつ `.tsx` で、node_modules の変換設定に依存するため、
// ここでは必要な部分だけを差し替える軽量なモックを自前で用意する。
// inset は全て 0（＝セーフエリア無し）にして、テストの期待値が
// 端末ごとの inset に左右されないようにする。
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };
  return {
    ...actual,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
    // ネイティブ実装を持たないので素通しにする。
    SafeAreaProvider: ({ children }) => children,
  };
});
