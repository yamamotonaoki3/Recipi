/**
 * プロフィールまわりの API 呼び出し関数（features/profile.md §5・image.md §5）。
 *
 * Phase 1 では表示名の更新だけを `features/auth/api.ts` に置いていたが、
 * プロフィール機能が育ったのでここへ移した（Issue #94）。
 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { ApiError } from "@/features/auth/api";
import type { UploadFile } from "@/features/image/api";

export type UserMeResponse = components["schemas"]["UserMeResponse"];
export type UpdateMeRequest = components["schemas"]["UpdateMeRequest"];
export type UserSelfProfile = components["schemas"]["UserSelfProfileResponse"];
export type UserPublicProfile = components["schemas"]["UserPublicProfileResponse"];

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

function toApiError(error: unknown, status: number, fallback: string): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? fallback;
  return new ApiError(message, envelope?.error?.code, status, envelope?.error?.details ?? null);
}

/**
 * ユーザーのプロフィールを取得する。
 *
 * 同じ URL でも「自分」なら全項目 ＋ 公開トグル（`UserSelfProfile`）、
 * 「他人」なら公開 ON の項目だけ（`UserPublicProfile`）が返る。
 */
export async function getUser(userId: string): Promise<UserSelfProfile | UserPublicProfile> {
  const { data, error, response } = await api.GET("/api/v1/users/{user_id}", {
    params: { path: { user_id: userId } },
  });
  if (error || !data) throw toApiError(error, response.status, "読み込みに失敗しました");
  // openapi-fetch の読み取り用の型変換は、本人向けの `isFollowing: null`（常に null の項目）を
  // 落としてしまい、生成された型と噛み合わない。中身は同じ契約なので型だけ合わせる。
  return data as UserSelfProfile | UserPublicProfile;
}

/** 自分のプロフィールだけを取得する。他人向けの形が返ったら契約違反としてエラーにする。 */
export async function getMyProfile(userId: string): Promise<UserSelfProfile> {
  const profile = await getUser(userId);
  // 本人向けの形にだけ `emailPublic` がある（他人向けには公開トグルを一切含めない）。
  if (!("emailPublic" in profile)) {
    throw new ApiError("読み込みに失敗しました", undefined, 500);
  }
  return profile;
}

/** 送った項目だけを更新する（送らなかった項目は変わらない。URL に null で削除）。 */
export async function updateMe(body: UpdateMeRequest): Promise<UserMeResponse> {
  const { data, error, response } = await api.PATCH("/api/v1/users/me", { body });
  if (error || !data) throw toApiError(error, response.status, "保存に失敗しました");
  return data;
}

/**
 * アバターを設定 / 差し替える。表示用 URL を返す。
 *
 * multipart の送り方は `features/image/api.ts` の `uploadImage` と同じ
 * （`Content-Type` を手で付けないこと。理由はそちらのコメント）。
 */
export async function putAvatar(file: UploadFile): Promise<{ avatarUrl: string }> {
  const { data, error, response } = await api.PUT("/api/v1/users/me/avatar", {
    body: { file: file as unknown as string },
    bodySerializer(body: { file: unknown }) {
      const form = new FormData();
      form.append("file", body.file as Blob);
      return form;
    },
  });
  if (error || !data) throw toApiError(error, response.status, "画像のアップロードに失敗しました");
  return data;
}

/** アバターを外す（設定していなくても成功する）。 */
export async function deleteAvatar(): Promise<void> {
  const { error, response } = await api.DELETE("/api/v1/users/me/avatar");
  if (error) throw toApiError(error, response.status, "画像の削除に失敗しました");
}
