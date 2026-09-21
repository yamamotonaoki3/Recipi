/**
 * アカウント設定（現在のパスワードで再認証してから認証情報を変える操作）の API 呼び出し。
 *
 * 表示名などの「見せ方」を変える `features/profile/` とは分ける（Issue #242）。
 * メールアドレスの変更（#243）もここに入る。
 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { apiErrorFromResponse } from "@/features/auth/api";

export type ChangeSecurityQuestionRequest = components["schemas"]["ChangeSecurityQuestionRequest"];

/**
 * 秘密の質問と答えを変更する。成功は 204（本文なし）。
 *
 * 現在のパスワードが違うときは **403 `REAUTH_FAILED`** が返る（401 ではない）。
 * 401 だと `src/api/client.ts` が「トークン切れ」と解釈してリフレッシュ → 再送 →
 * セッション破棄まで進み、打ち間違えただけで利用者がログアウトしてしまうため。
 */
export async function changeSecurityQuestion(body: ChangeSecurityQuestionRequest): Promise<void> {
  // 204 は本文が無いので `data` は空。`error` だけで失敗を判定する（deleteAvatar と同じ）。
  const { error, response } = await api.PUT("/api/v1/users/me/security-question", { body });
  if (error) throw apiErrorFromResponse(error, response, "変更に失敗しました");
}
