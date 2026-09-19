/**
 * 閲覧履歴（最近見たレシピ）の API 呼び出し（Issue #42）。
 *
 * 3 つの操作を扱う（features/view-history.md §5）:
 * - `recordRecipeView` … レシピ詳細を開いたときの記録（`POST /recipes/{id}/view`）
 * - `getHistory`       … 最近見た順の一覧
 * - `clearHistory`     … 履歴の全消去
 */
import { api } from "@/api/client";
import { apiErrorFromResponse } from "@/features/auth/api";
import type { components } from "@/api/schema";

export type HistoryResponse = components["schemas"]["HistoryResponse"];
export type HistoryItem = components["schemas"]["HistoryItem"];

/**
 * 閲覧を記録する（成功は 204、body なし）。
 *
 * 呼ぶのはレシピ詳細の取得に成功した後で、**画面はこの結果を待たない**
 * （fire-and-forget。processing-model.md §10 / view-history.md §3）。
 * 失敗しても「履歴に載らない」だけで、詳細の表示には影響させない。
 */
export async function recordRecipeView(recipeId: string): Promise<void> {
  const { error, response } = await api.POST("/api/v1/recipes/{recipe_id}/view", {
    params: { path: { recipe_id: recipeId } },
  });
  if (error) throw apiErrorFromResponse(error, response);
}

/** 最近見たレシピ一覧を 1 ページ取得する。 */
export async function getHistory(query: {
  cursor?: string;
  limit?: number;
}): Promise<HistoryResponse> {
  const { data, error, response } = await api.GET("/api/v1/users/me/history", {
    params: {
      query: {
        cursor: query.cursor || undefined,
        limit: query.limit,
      },
    },
  });
  if (error || !data) throw apiErrorFromResponse(error, response);
  return data;
}

/** 閲覧履歴を全消去する（成功は 204、body なし）。 */
export async function clearHistory(): Promise<void> {
  const { error, response } = await api.DELETE("/api/v1/users/me/history");
  if (error) throw apiErrorFromResponse(error, response);
}
