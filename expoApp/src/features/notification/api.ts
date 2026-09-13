/** 通知 API（features/notification.md §5）。 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { ApiError } from "@/features/auth/api";

export type NotificationItem = components["schemas"]["NotificationItem"];
export type NotificationListResponse = components["schemas"]["NotificationListResponse"];
export type UnreadCountResponse = components["schemas"]["UnreadCountResponse"];

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

function toApiError(error: unknown, status: number): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  return new ApiError(
    envelope?.error?.message ?? "通信エラーが発生しました",
    envelope?.error?.code,
    status,
    envelope?.error?.details ?? null,
  );
}

export async function listNotifications(query: {
  cursor?: string;
  limit?: number;
}): Promise<NotificationListResponse> {
  const { data, error, response } = await api.GET("/api/v1/notifications", {
    params: { query: { cursor: query.cursor || undefined, limit: query.limit } },
  });
  if (error || !data || !response.ok) throw toApiError(error, response.status);
  return data;
}

export async function getUnreadCount(): Promise<UnreadCountResponse> {
  const { data, error, response } = await api.GET("/api/v1/notifications/unread-count");
  if (error || !data || !response.ok) throw toApiError(error, response.status);
  return data;
}

/** ids 省略で全件、指定時は該当通知だけを既読化する。 */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const result = ids
    ? await api.POST("/api/v1/notifications/read", { body: { ids } })
    : await api.POST("/api/v1/notifications/read");
  if (result.error || !result.response.ok) {
    throw toApiError(result.error, result.response.status);
  }
}
