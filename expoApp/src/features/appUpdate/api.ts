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

type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string | null };

/**
 * `v1.2.3` / `v1.2.3-beta.1` → 構造化した値。末尾に余分な文字がある不正な
 * 形式（`v1.2.3junk`等）はnull（比較不能として扱う。Codexレビュー指摘）。
 */
function parseSemVer(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * SemVer仕様（https://semver.org/#spec-item-11）どおりのプレリリース識別子比較。
 * ドット区切りの各識別子を、数値同士は数値として、それ以外は文字列として比較する
 * （数値識別子は常に非数値識別子より小さい）。識別子の個数が少ない方が、
 * 共通部分が全て等しければ小さい（Codexレビュー指摘: 単純な文字列比較では
 * `beta.11` < `beta.2` になってしまい、実際の優先順位と食い違うため）。
 */
function comparePrereleaseIdentifiers(a: string, b: string): number {
  const partsA = a.split(".");
  const partsB = b.split(".");
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const pa = partsA[i];
    const pb = partsB[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    const na = /^\d+$/.test(pa) ? Number(pa) : null;
    const nb = /^\d+$/.test(pb) ? Number(pb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb;
      continue;
    }
    if (na !== null) return -1; // 数値識別子 < 非数値識別子
    if (nb !== null) return 1;
    if (pa !== pb) return pa < pb ? -1 : 1;
  }
  return 0;
}

/**
 * `a`が`b`より新しければ true。比較不能なら false（安全側＝更新なし扱い）。
 * SemVerの優先順位規則どおり、コア版が同じならプレリリース版は正式版より
 * 古いものとして扱う（Codexレビュー指摘）。
 */
function isNewerVersion(a: string, b: string): boolean {
  const va = parseSemVer(a);
  const vb = parseSemVer(b);
  if (!va || !vb) return false;
  if (va.major !== vb.major) return va.major > vb.major;
  if (va.minor !== vb.minor) return va.minor > vb.minor;
  if (va.patch !== vb.patch) return va.patch > vb.patch;
  if (va.prerelease === vb.prerelease) return false;
  if (va.prerelease === null) return true; // 正式版 > プレリリース
  if (vb.prerelease === null) return false;
  return comparePrereleaseIdentifiers(va.prerelease, vb.prerelease) > 0;
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
