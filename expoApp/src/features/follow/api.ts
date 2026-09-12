/**
 * フォローまわりの API 呼び出し関数（features/follow.md §5。Issue #96）。
 *
 * - フォロー / 解除: `POST` / `DELETE /users/{id}/follow`（どちらも冪等で 204）
 * - 一覧: 自分のものは `/users/me/following` など、他人のものは
 *   `/users/{id}/following` など。形はどちらも同じ（`UserRowListResponse`）。
 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { ApiError } from "@/features/auth/api";

export type UserRow = components["schemas"]["UserRow"];
export type UserRowListResponse = components["schemas"]["UserRowListResponse"];

/** 「フォロー中」タブか「フォロワー」タブか。 */
export type ConnectionTab = "following" | "followers";

/** 一覧の対象。自分なら `"me"`（自分の ID を知らなくても呼べるショートカット）。 */
export type ConnectionTarget = "me" | (string & {});

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

function toApiError(error: unknown, status: number, fallback: string): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? fallback;
  return new ApiError(message, envelope?.error?.code, status, envelope?.error?.details ?? null);
}

/** `userId` をフォローする（二重にフォローしても成功する）。 */
export async function followUser(userId: string): Promise<void> {
  const { error, response } = await api.POST("/api/v1/users/{user_id}/follow", {
    params: { path: { user_id: userId } },
  });
  if (error) throw toApiError(error, response.status, "フォローに失敗しました");
}

/** `userId` のフォローを解除する（フォローしていなくても成功する）。 */
export async function unfollowUser(userId: string): Promise<void> {
  const { error, response } = await api.DELETE("/api/v1/users/{user_id}/follow", {
    params: { path: { user_id: userId } },
  });
  if (error) throw toApiError(error, response.status, "フォロー解除に失敗しました");
}

/**
 * フォロー中 / フォロワーの一覧を 1 ページ取る（カーソルページング）。
 *
 * openapi-fetch は URL ごとに型が決まるので、4 通りの URL を分岐で書き分ける。
 */
export async function listConnections(
  target: ConnectionTarget,
  tab: ConnectionTab,
  query: { cursor?: string; limit?: number } = {},
): Promise<UserRowListResponse> {
  const params = { query: { cursor: query.cursor || undefined, limit: query.limit } };
  const result =
    target === "me"
      ? tab === "following"
        ? await api.GET("/api/v1/users/me/following", { params })
        : await api.GET("/api/v1/users/me/followers", { params })
      : tab === "following"
        ? await api.GET("/api/v1/users/{user_id}/following", {
            params: { ...params, path: { user_id: target } },
          })
        : await api.GET("/api/v1/users/{user_id}/followers", {
            params: { ...params, path: { user_id: target } },
          });

  const { data, error, response } = result;
  if (error || !data) throw toApiError(error, response.status, "読み込みに失敗しました");
  return data;
}
