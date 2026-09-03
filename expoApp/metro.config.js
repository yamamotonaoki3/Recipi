// Metro（Expo のバンドラ）の設定。
// NativeWind を有効にするため、Expo 標準の設定を withNativeWind で包む。
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./src/global.css" });
