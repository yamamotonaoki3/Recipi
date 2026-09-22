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
// 画像ピッカーと画像加工はネイティブモジュールなので、jest（Node 上の
// テスト環境）には実装が無い。既定では「キャンセルされた」を返すモックにし、
// 選択を伴うテストだけが `mockResolvedValue` で上書きする。
// 権限は常に許可（granted）にして、テストが権限ダイアログに依存しないようにする。
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
}));

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  // `manipulate(uri).resize(...)` → `renderAsync()` → `saveAsync()` の
  // チェーンを、加工せず元の uri を返すだけの形で再現する。
  ImageManipulator: {
    manipulate: jest.fn((uri) => {
      const context = {
        resize: jest.fn(() => context),
        renderAsync: jest.fn(async () => ({
          saveAsync: jest.fn(async () => ({ uri, width: 100, height: 100 })),
          release: jest.fn(),
        })),
        release: jest.fn(),
      };
      return context;
    }),
  },
}));

// ネイティブで選んだ画像の URI を実体の Blob として読むために `pickImage.ts` が使う
// （Issue #285。Expo の fetch は React Native 独自の `{ uri, name, type }` 形式を
// 受け付けないため）。jest（Node）には `XMLHttpRequest` の実装が無く、テストごとに
// 差し替えるのも手間なので、既定で空の Blob を即座に返すモックをここに置く。
// 実際の中身を確かめたいテストは `global.XMLHttpRequest` を個別に上書きする。
global.XMLHttpRequest = jest.fn().mockImplementation(() => {
  const xhr = {
    open: jest.fn(),
    send: jest.fn(() => xhr.onload?.()),
    response: new Blob([], { type: "image/jpeg" }),
    responseType: "",
    onload: null,
    onerror: null,
  };
  return xhr;
});

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
