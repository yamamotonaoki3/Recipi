/**
 * セキュアストレージが使えない環境（Tauri を経由しないブラウザ単体）向けの
 * フォールバック実装。「ログインを保持」を永続化できないだけで、
 * アプリ自体は動く（毎回ログインが必要になる）。
 */
import type { SecureStorage } from "./types";

export const unsupportedSecureStorage: SecureStorage = {
  async getRefreshToken() {
    return null;
  },
  async setRefreshToken() {
    console.warn(
      "この環境（ブラウザ単体）では「ログインを保持」を永続化できません。デスクトップアプリ版または iOS/Android アプリをご利用ください。",
    );
  },
  async deleteRefreshToken() {
    // 何も保存していないので何もしない。
  },
  async getUser() {
    return null;
  },
  async setUser() {
    // getRefreshToken 同様、この環境では何も永続化しない。
  },
  async deleteUser() {
    // 何も保存していないので何もしない。
  },
};
