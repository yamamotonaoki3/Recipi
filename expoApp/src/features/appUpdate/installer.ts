/**
 * 未署名インストーラーへの導線（Issue #319）。
 *
 * OS別の配布URL（`.msi`/`.apk`）を選び、無ければReleaseページへ
 * フォールバックして開く。実際のダウンロード・インストールはOS/ブラウザの
 * 責務で、アプリからは観測できない（URL起動そのものの成否だけ分かる）。
 */
import { Platform } from "react-native";

import { getLatestReleaseUrl } from "./config";
import { openReleasePage } from "./openExternal";
import type { ReleaseInfo } from "./types";
import { isTauri } from "@/lib/tauriEnv";

export type InstallResult = { ok: boolean };

/**
 * 現在のプラットフォームに応じた配布物URLを選ぶ（無ければReleaseページ）。
 * 空文字も「無し」として扱うため`||`を使う（`??`はnull/undefinedのみ）。
 */
function pickInstallUrl(release: ReleaseInfo): string {
  if (isTauri()) {
    return release.assets.msiUrl || release.bodyUrl || getLatestReleaseUrl();
  }
  if (Platform.OS === "android") {
    return release.assets.apkUrl || release.bodyUrl || getLatestReleaseUrl();
  }
  // Web等、配布物を持たないプラットフォームはReleaseページへ。
  return release.bodyUrl || getLatestReleaseUrl();
}

export async function startInstall(release: ReleaseInfo): Promise<InstallResult> {
  const url = pickInstallUrl(release);
  // URL起動そのものは既存の openReleasePage と同じ仕組み
  // （Linking.openURL / Tauriの@tauri-apps/plugin-opener）で行う。
  return openReleasePage(url);
}
