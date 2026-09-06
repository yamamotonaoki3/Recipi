/**
 * リフレッシュトークンのセキュアストレージ。実行環境ごとに実装を出し分ける。
 *
 * - iOS / Android: `secureStorage.native.ts`（expo-secure-store）
 * - Tauri デスクトップ: `secureStorage.tauri.ts`（tauri-plugin-stronghold）
 * - それ以外（ブラウザ単体）: `secureStorage.unsupported.ts`（永続化しない）
 *
 * `Platform.OS` だけでは Tauri と RN Web を区別できないため、
 * `isTauri()`（src/lib/tauriEnv.ts）でランタイム判定する。Metro の
 * `.native.ts` 拡張子による自動解決はビルド時に固定されるため、
 * 同じ Web バンドルを Tauri でもブラウザでも使うこの構成には使えない。
 */
import { Platform } from "react-native";

import { isTauri } from "../tauriEnv";
import { nativeSecureStorage } from "./secureStorage.native";
import { tauriSecureStorage } from "./secureStorage.tauri";
import { unsupportedSecureStorage } from "./secureStorage.unsupported";
import type { SecureStorage } from "./types";

export type { SecureStorage } from "./types";

function selectSecureStorage(): SecureStorage {
  if (Platform.OS !== "web") return nativeSecureStorage;
  return isTauri() ? tauriSecureStorage : unsupportedSecureStorage;
}

export const secureStorage: SecureStorage = selectSecureStorage();
