/**
 * iOS / Android でのセキュアストレージ実装。
 *
 * `expo-secure-store` は内部で iOS の Keychain / Android の Keystore を
 * 使ってくれる（features/auth.md の要求どおり）。
 */
import * as SecureStore from "expo-secure-store";

import type { SecureStorage } from "./types";

const REFRESH_TOKEN_KEY = "recipi.refreshToken";
const USER_KEY = "recipi.user";

export const nativeSecureStorage: SecureStorage = {
  async getRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },
  async setRefreshToken(token: string) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },
  async deleteRefreshToken() {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
  async getUser() {
    return SecureStore.getItemAsync(USER_KEY);
  },
  async setUser(userJson: string) {
    await SecureStore.setItemAsync(USER_KEY, userJson);
  },
  async deleteUser() {
    await SecureStore.deleteItemAsync(USER_KEY);
  },
};
