// Babel の設定。Metro（Expo のバンドラ）がこれを読んで JS/TS を変換する。
// - babel-preset-expo: Expo 標準の変換
// - jsxImportSource: nativewind → className を使えるようにする
// - nativewind/babel: NativeWind のプリセット
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
