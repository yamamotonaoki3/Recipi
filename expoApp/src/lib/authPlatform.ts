/** 認証トークンの運搬方式を実行環境ごとに判定する。 */
import { Platform } from "react-native";

import { isTauri } from "./tauriEnv";

/**
 * 通常ブラウザだけは HttpOnly Cookie を使う。
 * Tauri は RN Web を使うが、refresh token は Stronghold に保存するため除外する。
 */
export function usesCookieAuth(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && !isTauri();
}

/**
 * Tauri の開発時は dev server（http://localhost:8081）が Origin になる。
 * バックエンドが通常ブラウザと区別して token 応答を返せるようにする印。
 * 本番の Tauri は tauri:// Origin のためこの印がなくても Cookie 認証にはならない。
 */
export function isTauriTokenClient(): boolean {
  return Platform.OS === "web" && isTauri();
}
