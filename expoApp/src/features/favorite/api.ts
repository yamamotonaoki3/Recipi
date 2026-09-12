/**
 * お気に入りの API 呼び出し（features/favorite.md §5。Issue #100）。
 *
 * - 登録: `POST /recipes/{id}/favorite`（二重に登録しても成功する）
 * - 解除: `DELETE /recipes/{id}/favorite`（登録していなくても成功する）
 *
 * お気に入り一覧はホームの「お気に入りレシピ」タブで、`GET /recipes?feed=favorites`
 * （`features/feed/api.ts` の `listFeed`）を使う。
 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { ApiError } from "@/features/auth/api";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

function toApiError(error: unknown, status: number, fallback: string): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? fallback;
  return new ApiError(message, envelope?.error?.code, status, envelope?.error?.details ?? null);
}

/** レシピをお気に入りに登録する（公開レシピ、または自分の非公開レシピだけ。他は 404）。 */
export async function favoriteRecipe(recipeId: string): Promise<void> {
  const { error, response } = await api.POST("/api/v1/recipes/{recipe_id}/favorite", {
    params: { path: { recipe_id: recipeId } },
  });
  // 本文が無いと error が空でも、HTTP ステータスが失敗なら成功扱いにしない。
  if (error || !response.ok) {
    throw toApiError(error, response.status, "お気に入りに追加できませんでした");
  }
}

/** お気に入りを解除する（非公開化された他人のレシピでも解除できる）。 */
export async function unfavoriteRecipe(recipeId: string): Promise<void> {
  const { error, response } = await api.DELETE("/api/v1/recipes/{recipe_id}/favorite", {
    params: { path: { recipe_id: recipeId } },
  });
  // 本文が無いと error が空でも、HTTP ステータスが失敗なら成功扱いにしない。
  if (error || !response.ok) {
    throw toApiError(error, response.status, "お気に入りを解除できませんでした");
  }
}
