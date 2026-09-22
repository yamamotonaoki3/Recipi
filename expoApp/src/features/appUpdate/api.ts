/**
 * GitHub Releaseの新版検出（Issue #318）。
 *
 * backendとは完全に独立させる要件のため、`api`クライアント（openapi-fetch）は
 * 使わず`fetch`を直接呼ぶ。通信失敗・レート制限・不正レスポンスでも例外を
 * 投げず、必ず`{state, release?}`を返す（呼び出し側はtry/catch不要）。
 */
import { getCurrentAppVersion, getReleasesApiUrl } from "./config";
import type { ReleaseInfo, UpdateState } from "./types";

const FETCH_TIMEOUT_MS = 8_000;

type GithubReleaseResponse = {
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  body?: unknown;
  assets?: unknown;
};

/** `v1.2.3` → `[1,2,3]`。SemVer以外は`null`（比較不能として扱う）。 */
function parseSemVer(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `a`が`b`より新しければ true。比較不能なら false（安全側＝更新なし扱い）。 */
function isNewerVersion(a: string, b: string): boolean {
  const va = parseSemVer(a);
  const vb = parseSemVer(b);
  if (!va || !vb) return false;
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] > vb[i];
  }
  return false;
}

function findAssetUrl(assets: unknown, suffix: string): string | undefined {
  if (!Array.isArray(assets)) return undefined;
  for (const asset of assets) {
    if (
      typeof asset === "object" &&
      asset !== null &&
      "name" in asset &&
      "browser_download_url" in asset &&
      typeof asset.name === "string" &&
      typeof asset.browser_download_url === "string" &&
      asset.name.endsWith(suffix)
    ) {
      return asset.browser_download_url;
    }
  }
  return undefined;
}

function toReleaseInfo(data: GithubReleaseResponse): ReleaseInfo | null {
  if (typeof data.tag_name !== "string" || typeof data.html_url !== "string") return null;
  const version = data.tag_name.replace(/^v/, "");
  return {
    version,
    title: typeof data.name === "string" && data.name.length > 0 ? data.name : data.tag_name,
    publishedAt: typeof data.published_at === "string" ? data.published_at : "",
    bodyUrl: data.html_url,
    assets: {
      msiUrl: findAssetUrl(data.assets, ".msi"),
      apkUrl: findAssetUrl(data.assets, ".apk"),
    },
  };
}

export async function checkForUpdate(): Promise<{ state: UpdateState; release?: ReleaseInfo }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(getReleasesApiUrl(), {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      // 404（Releaseが1つも無い）は「更新なし」、それ以外（レート制限等）は「確認失敗」。
      return { state: response.status === 404 ? "upToDate" : "checkFailed" };
    }
    const data = (await response.json()) as GithubReleaseResponse;
    const release = toReleaseInfo(data);
    if (!release) return { state: "checkFailed" };

    const currentVersion = await getCurrentAppVersion();
    if (isNewerVersion(release.version, currentVersion)) {
      return { state: "updateAvailable", release };
    }
    return { state: "upToDate", release };
  } catch {
    return { state: "checkFailed" };
  } finally {
    clearTimeout(timer);
  }
}
