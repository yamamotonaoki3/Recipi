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
];

module.exports = withNativeWind(config, { input: "./src/global.css" });
