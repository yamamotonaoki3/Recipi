/**
 * プロフィール編集フォームの純粋関数（Issue #94）。
 *
 * React から切り離しておくと、「どの項目が変わったか」「送る body はどうなるか」
 * を単体テストだけで確かめられる（レシピフォームの recipeForm.ts と同じ考え方）。
 *
 * アバターはここに含めない。アバターは選んだ時点でサーバーに保存される
 * （screens/profile-edit.md §5「即時反映」）ので、「保存」ボタンの対象外。
 */
import { localizeServerValidationMessage, validateDisplayName } from "@/features/auth/validation";
import { countChars } from "@/lib/textLength";

import type { UpdateMeRequest, UserSelfProfile } from "./api";
import { isBlankUrl, validateProfileUrl } from "./validation";

export type ProfileFormValues = {
  displayName: string;
  bio: string;
  emailPublic: boolean;
  xUrl: string;
  xPublic: boolean;
  instagramUrl: string;
  instagramPublic: boolean;
  otherUrl: string;
  otherPublic: boolean;
};

export type ProfileField = keyof ProfileFormValues;
export type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

const URL_FIELDS = ["xUrl", "instagramUrl", "otherUrl"] as const;
const TOGGLE_FIELDS = ["emailPublic", "xPublic", "instagramPublic", "otherPublic"] as const;
export const BIO_MAX_LENGTH = 2000;

/** JavaScript の UTF-16 ではなく、backend と同じ Unicode コードポイントで数える（共通の countChars）。 */
export function bioLength(value: string): number {
  return countChars(value);
}

/** 入力を最大文字数で切る。絵文字も 1 文字として扱う。 */
export function limitBio(value: string): string {
  return Array.from(value).slice(0, BIO_MAX_LENGTH).join("");
}

/** サーバーの値をフォームの値に変換する（入力欄は null を扱えないので空文字にする）。 */
export function fromProfile(profile: UserSelfProfile): ProfileFormValues {
  return {
    displayName: profile.displayName,
    bio: profile.bio ?? "",
    emailPublic: profile.emailPublic,
    xUrl: profile.xUrl ?? "",
    xPublic: profile.xPublic,
    instagramUrl: profile.instagramUrl ?? "",
    instagramPublic: profile.instagramPublic,
    otherUrl: profile.otherUrl ?? "",
    otherPublic: profile.otherPublic,
  };
}

/** 空・空白だけは null、それ以外は改行と前後空白を含めてそのまま送る。 */
function normalizeBio(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/** URL 欄の値を送信用に正規化する（空・空白だけは null＝削除）。 */
function normalizeUrl(value: string): string | null {
  return isBlankUrl(value) ? null : value.trim();
}

/** フォーム全体を検証する。エラーが無ければ空オブジェクト。 */
export function validateProfileForm(values: ProfileFormValues): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const displayName = validateDisplayName(values.displayName);
  if (displayName) errors.displayName = displayName;
  if (bioLength(values.bio) > BIO_MAX_LENGTH) {
    errors.bio = `自己紹介文は${BIO_MAX_LENGTH.toLocaleString()}文字以内で入力してください`;
  }
  for (const field of URL_FIELDS) {
    const error = validateProfileUrl(values[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

/**
 * 変更のあった項目だけを入れた PATCH の body を作る。
 *
 * 送らなかった項目はサーバー側で変わらない（profile.md §5）ので、
 * 触っていない項目まで送る必要はない。URL は正規化後の値で比べるので、
 * 前後に空白を足しただけの入力は「変更なし」になる。
 */
export function buildPatch(
  initial: ProfileFormValues,
  current: ProfileFormValues,
): UpdateMeRequest {
  const patch: UpdateMeRequest = {};
  if (current.displayName !== initial.displayName) {
    patch.displayName = current.displayName;
  }
  const nextBio = normalizeBio(current.bio);
  if (nextBio !== normalizeBio(initial.bio)) patch.bio = nextBio;
  for (const field of URL_FIELDS) {
    const next = normalizeUrl(current[field]);
    if (next !== normalizeUrl(initial[field])) patch[field] = next;
  }
  for (const field of TOGGLE_FIELDS) {
    if (current[field] !== initial[field]) patch[field] = current[field];
  }
  return patch;
}

/** 未保存の変更があるか（戻るときの確認ダイアログに使う）。 */
export function isDirty(initial: ProfileFormValues, current: ProfileFormValues): boolean {
  return Object.keys(buildPatch(initial, current)).length > 0;
}

/**
 * サーバーの 400（`details.errors[].loc`）をフォームの欄に割り当てる。
 *
 * `loc` は `["body", "xUrl"]` のような形。知らない欄のエラーは返さない
 * （呼び出し側が「保存に失敗しました」にまとめる）。
 */
export function mapServerErrors(details: Record<string, unknown> | null): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const list = details?.errors;
  if (!Array.isArray(list)) return errors;
  const known = new Set<string>([...URL_FIELDS, ...TOGGLE_FIELDS, "displayName", "bio"]);
  for (const item of list as { loc?: unknown; msg?: unknown }[]) {
    if (!Array.isArray(item.loc)) continue;
    const field = item.loc.find((part): part is ProfileField => known.has(String(part)));
    if (field && !errors[field]) {
      errors[field] = localizeServerValidationMessage(field, item.msg);
    }
  }
  return errors;
}
