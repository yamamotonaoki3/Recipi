/**
 * 感想（コメント）の API 呼び出し（features/comment.md §5。Issue #102）。
 *
 * - 一覧: `GET /recipes/{id}/comments`（新しい順・カーソルページング）
 * - 投稿: `POST /recipes/{id}/comments`（レシピ投稿者本人は 403）
 * - 編集: `PATCH /comments/{id}`（感想の投稿者本人だけ。送った項目だけ変わる）
 * - 削除: `DELETE /comments/{id}`（感想の投稿者本人か、レシピの投稿者）
 *
 * 失敗の判定は `error` だけでなく `response.ok` も見る。本文の無い失敗（502 など）では
 * `error` が空になり、成功と見分けられないため（lessons #100-1）。
 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { ApiError } from "@/features/auth/api";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
export type Comment = components["schemas"]["CommentResponse"];
export type CommentList = components["schemas"]["CommentListResponse"];
export type CommentCreate = components["schemas"]["CommentCreateRequest"];
/**
 * 編集の body。`body` は送ったときだけ変わり、**null は送れない**（本文は必須）。
 * `imageKey` は 省略 = 変更なし / 今と同じキー = 維持 / null = 削除 / 新しいキー = 差し替え。
 */
export type CommentUpdate = components["schemas"]["CommentUpdateRequest"];

function toApiError(error: unknown, status: number, fallback: string): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? fallback;
  return new ApiError(message, envelope?.error?.code, status, envelope?.error?.details ?? null);
}

/** あるレシピの感想一覧（1 ページ分）。 */
export async function listComments(
  recipeId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<CommentList> {
  const { data, error, response } = await api.GET("/api/v1/recipes/{recipe_id}/comments", {
    params: { path: { recipe_id: recipeId }, query: params },
  });
  if (error || !response.ok || !data) {
    throw toApiError(error, response.status, "感想を読み込めませんでした");
  }
  return data;
}

/** 感想を投稿する。作られた感想を返す。 */
export async function createComment(recipeId: string, input: CommentCreate): Promise<Comment> {
  const { data, error, response } = await api.POST("/api/v1/recipes/{recipe_id}/comments", {
    params: { path: { recipe_id: recipeId } },
    body: input,
  });
  if (error || !response.ok || !data) {
    throw toApiError(error, response.status, "感想を投稿できませんでした");
  }
  return data;
}

/** 感想を編集する。編集後の感想を返す。 */
export async function updateComment(commentId: string, input: CommentUpdate): Promise<Comment> {
  const { data, error, response } = await api.PATCH("/api/v1/comments/{comment_id}", {
    params: { path: { comment_id: commentId } },
    body: input,
  });
  if (error || !response.ok || !data) {
    throw toApiError(error, response.status, "感想を保存できませんでした");
  }
  return data;
}

/** 感想を削除する。 */
export async function deleteComment(commentId: string): Promise<void> {
  const { error, response } = await api.DELETE("/api/v1/comments/{comment_id}", {
    params: { path: { comment_id: commentId } },
  });
  if (error || !response.ok) {
    throw toApiError(error, response.status, "感想を削除できませんでした");
  }
}
