/**
 * ホームフィード（「全体」タブ ＋ 検索）の API 呼び出し（Issue #42）。
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
 * `feed` は **"all" 固定**。MVP で機能するのは「全体」タブだけで、
 * サーバーも `feed=all` 以外を 400 で弾く（Issue #41）。「フォロー」等の
 * 準備中タブは、そもそもこの関数を呼ばずに画面側で「準備中」を出す。
 *
 * `q` が空文字のときは `undefined` にして**クエリ自体を送らない**。
 * 空文字を送ると「空の検索語で絞り込む」という別の意味になりかねないため。
 */
export async function listFeed(query: {
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<RecipeFeedResponse> {
  const { data, error, response } = await api.GET("/api/v1/recipes", {
    params: {
      query: {
        feed: "all",
        q: query.q || undefined,
        cursor: query.cursor || undefined,
        limit: query.limit,
      },
    },
  });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}
