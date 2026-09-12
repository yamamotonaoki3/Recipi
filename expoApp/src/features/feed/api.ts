/**
 * ホームフィードの API 呼び出し（Issue #42・#98）。
 *
 * `features/recipe/api.ts` と同じ方針: openapi-fetch の `error` / `data` 分岐を
 * ここでまとめ、hook 側は「成功データ」か「投げられた `ApiError`」だけを見ればよい
 * ようにする。`ApiError` は auth 側の実装を再利用する。
 */
import { api } from "@/api/client";
import { ApiError } from "@/features/auth/api";
import type { components } from "@/api/schema";

export type RecipeFeedResponse = components["schemas"]["RecipeFeedResponse"];
export type RecipeFeedItem = components["schemas"]["RecipeFeedItem"];

/**
 * ホームのサブタブのうち、フィードを取得できるもの（features/home-feed.md §5）。
 *
 * - `all`       … 全体（すべての公開レシピ）
 * - `following` … 自分がフォローしている人の公開レシピ（Issue #98 で有効化）
 * - `followers` … 自分をフォローしている人の公開レシピ（Issue #98 で有効化）
 * - `favorites` … 自分がお気に入りしたレシピ（自分の非公開も含む。登録日時の新しい順。
 *                 Issue #100 で有効化。features/favorite.md §3）
 */
export type FeedKind = "all" | "following" | "followers" | "favorites";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

function toApiError(error: unknown, status: number): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? "通信エラーが発生しました";
  const code = envelope?.error?.code;
  return new ApiError(message, code, status, envelope?.error?.details ?? null);
}

/**
 * ホームフィードを 1 ページ取得する（features/home-feed.md §5）。
 *
 * `feed` を省略すると `all`（全体）。検索語 `q` は表示中のタブの集合の中を
 * 絞り込むので、`feed` と一緒に送る（home-feed.md §3）。
 *
 * `q` が空文字のときは `undefined` にして**クエリ自体を送らない**。
 * 空文字を送ると「空の検索語で絞り込む」という別の意味になりかねないため。
 */
export async function listFeed(query: {
  feed?: FeedKind;
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<RecipeFeedResponse> {
  const { data, error, response } = await api.GET("/api/v1/recipes", {
    params: {
      query: {
        feed: query.feed ?? "all",
        q: query.q || undefined,
        cursor: query.cursor || undefined,
        limit: query.limit,
      },
    },
  });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}
