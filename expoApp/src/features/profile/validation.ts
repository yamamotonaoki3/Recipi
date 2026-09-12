/**
 * プロフィール編集のクライアント側バリデーション（features/profile.md §6）。
 *
 * 表示名は認証画面と同じルールなので `features/auth/validation.ts` を使う。
 * ここには SNS / その他 URL の検証だけを置く。
 */

/** URL の最大文字数（サーバーと同じ。文字数で数える）。 */
export const PROFILE_URL_MAX_LENGTH = 2048;

/** 空・空白だけは「未設定」扱い（サーバーも null として保存する）。 */
export function isBlankUrl(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * URL 欄を検証する。問題なければ undefined。
 *
 * `http://` か `https://` で始まり、空白を含まないこと（サーバーと同じ条件）。
 * ドメインの許可リストは採らない（todo.md #14 で確定）。
 * 文字数は `Array.from` でコードポイント単位に数える（絵文字を 2 と数えない）。
 */
export function validateProfileUrl(value: string): string | undefined {
  if (isBlankUrl(value)) return undefined;
  const trimmed = value.trim();
  if (Array.from(trimmed).length > PROFILE_URL_MAX_LENGTH) {
    return `URL は${PROFILE_URL_MAX_LENGTH}文字以内で入力してください`;
  }
  if (!/^https?:\/\/\S+$/.test(trimmed)) {
    return "URL は http:// または https:// で始まる形式で入力してください";
  }
  return undefined;
}
