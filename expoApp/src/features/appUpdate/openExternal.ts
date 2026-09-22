/**
 * 外部ブラウザでURLを開く（Issue #317「リリース内容を見る」）。
 *
 * Web / Android は `Linking.openURL`（既存パターン: `UserProfileScreen.tsx`）で開ける。
 * Tauri（デスクトップ）のWebView内では `window.open()` が既定でブロックされ、
 * `Linking.openURL` だけではOS既定のブラウザを開けないため、
 * `@tauri-apps/plugin-opener` の `openUrl()` を使う
 * （`resolve-tech-stack` スキルでユーザー確認済み。`src-tauri/capabilities/default.json`
 * に `opener:allow-open-url` 権限を追加済み）。
 *
 * どのプラットフォームでも、起動に失敗した場合にアプリをクラッシュさせない。
 */
import { Linking } from "react-native";
import { openUrl } from "@tauri-apps/plugin-opener";

import { isTauri } from "@/lib/tauriEnv";

export async function openReleasePage(url: string): Promise<{ ok: boolean }> {
  try {
    if (isTauri()) {
      await openUrl(url);
    } else {
      await Linking.openURL(url);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
