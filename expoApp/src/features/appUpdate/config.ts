/**
 * 更新機能の設定を一箇所に集約する（Issue #317）。
 *
 * GitHubリポジトリの owner/repo と、現在のアプリバージョンの取得元を
 * ここだけに閉じ込め、使用箇所ごとに `process.env.EXPO_PUBLIC_*` を
 * 直接参照させない（バックエンドのAPI URLとは完全に別系統の環境変数）。
 */
import Constants from "expo-constants";
import { getVersion as getTauriVersion } from "@tauri-apps/api/app";

import { isTauri } from "@/lib/tauriEnv";

/** フォールバック: 環境変数が無くてもビルドが壊れないよう既定値を持つ（実在のリポジトリ）。 */
const DEFAULT_GITHUB_OWNER = "yamamotonaoki3";
const DEFAULT_GITHUB_REPO = "Recipi";

export function getGithubOwner(): string {
  return process.env.EXPO_PUBLIC_GITHUB_OWNER ?? DEFAULT_GITHUB_OWNER;
}

export function getGithubRepo(): string {
  return process.env.EXPO_PUBLIC_GITHUB_REPO ?? DEFAULT_GITHUB_REPO;
}

/** GitHub Releaseの「最新版」詳細ページのURL。 */
export function getLatestReleaseUrl(): string {
  return `https://github.com/${getGithubOwner()}/${getGithubRepo()}/releases/latest`;
}

/** GitHub Release一覧APIのURL（Stage 2の `checkForUpdate()` が使う）。 */
export function getReleasesApiUrl(): string {
  return `https://api.github.com/repos/${getGithubOwner()}/${getGithubRepo()}/releases/latest`;
}

/**
 * 現在のアプリバージョンを取得する。
 *
 * - Tauri（デスクトップ）: `@tauri-apps/api/app` の `getVersion()`（非同期、`tauri.conf.json` の値）。
 * - それ以外（Web / Android）: `expo-constants` の `Constants.expoConfig?.version`（`app.json` の値）。
 */
export async function getCurrentAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      return await getTauriVersion();
    } catch {
      // Tauri判定は通ったがAPI呼び出しに失敗した場合（環境不整合等）。
      return Constants.expoConfig?.version ?? "unknown";
    }
  }
  return Constants.expoConfig?.version ?? "unknown";
}
