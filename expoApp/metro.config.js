// Metro（Expo のバンドラ）の設定。
// NativeWind を有効にするため、Expo 標準の設定を withNativeWind で包む。
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// src/app 配下の *.test.ts(x) が Expo Router のファイルベースルーティングに
// ルートとして拾われ、jest グローバル（expect 等）未定義のまま export/build
// 時にバンドルされて失敗するため、Metro のバンドル対象から除外する。
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  /.*\.test\.[jt]sx?$/,
  // Tauri の Rust ビルド中に target 配下の一時ファイルが作成・削除される。
  // Metro がこれを監視すると、削除直後に ENOENT が発生して開発サーバーが
  // 終了するため、Tauri の生成物は監視対象から除外する。
  /.*[\\/]src-tauri[\\/]target[\\/].*/,
];

module.exports = withNativeWind(config, { input: "./src/global.css" });
