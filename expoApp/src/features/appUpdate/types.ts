/**
 * 更新機能（アプリ情報・GitHub Release確認・接続不能警告）の共有型。
 *
 * Stage 1 では型だけを定義する（`docs/requirements/features/update.md`）。
 * Stage 2 以降で実データ・実装が入るが、ここで定義したフィールドは
 * 追加のみとし、削除・型変更はしない（既存の消費側を壊さないため）。
 */

/** GitHub Releaseの情報（Stage 2で `checkForUpdate()` が実際に埋める）。 */
export type ReleaseInfo = {
  /** SemVer形式のバージョン文字列（例: "1.2.3"、先頭の "v" は含まない）。 */
  version: string;
  /** Releaseのタイトル。 */
  title: string;
  /** 公開日時（ISO 8601）。 */
  publishedAt: string;
  /** Release本文（詳細ページ）のURL。 */
  bodyUrl: string;
  /** プラットフォーム別の配布物URL（Stage 3で利用）。無ければ`bodyUrl`にフォールバックする。 */
  assets: {
    msiUrl?: string;
    apkUrl?: string;
  };
};

/** 更新確認の状態（Stage 2で `checkForUpdate()` が返す）。 */
export type UpdateState = "idle" | "checking" | "upToDate" | "updateAvailable" | "checkFailed";
