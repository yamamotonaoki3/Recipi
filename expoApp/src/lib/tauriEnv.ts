/**
 * 「今、Tauri（デスクトップアプリ）の中で動いているか」を判定する。
 *
 * `Platform.OS`（react-native）だけでは判定できない: Tauri はネイティブの
 * WebView に React Native Web のビルドを読み込ませているだけなので、
 * `Platform.OS` は "web" になり、ブラウザ単体で開いた場合と区別が付かない。
 * `@tauri-apps/api` が公式に提供する `isTauri()` は、Tauri が WebView に
 * 注入するグローバル変数の有無を見て判定してくれる。
 */
export { isTauri } from "@tauri-apps/api/core";
