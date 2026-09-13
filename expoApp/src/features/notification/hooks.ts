/** 通知一覧・未読件数・既読操作の TanStack Query hooks。 */
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import {
  getUnreadCount,
  listNotifications,
  markNotificationsRead,
  type NotificationListResponse,
  type UnreadCountResponse,
} from "./api";
import { useSession } from "@/store/session";

export const notificationKeys = {
  root: ["notifications"] as const,
  list: (userId: string) => ["notifications", userId, "list"] as const,
  unread: (userId: string) => ["notifications", userId, "unread"] as const,
};

function useNotificationIdentity() {
  const userId = useSession((state) => state.user?.id) ?? "anonymous";
  const enabled = useSession((state) => state.hydrated && state.isAuthenticated);
  return { userId, enabled };
}

export function useNotifications() {
  const { userId, enabled } = useNotificationIdentity();
  return useInfiniteQuery({
    queryKey: notificationKeys.list(userId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listNotifications({ cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

export function useUnreadNotificationCount() {
  const { userId, enabled } = useNotificationIdentity();
  const query = useQuery({
    queryKey: notificationKeys.unread(userId),
    queryFn: getUnreadCount,
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && enabled) void refetch();
    });
    return () => subscription.remove();
  }, [enabled, refetch]);
  return query;
}

type Snapshot = {
  lists: [readonly unknown[], InfiniteData<NotificationListResponse> | undefined][];
  unread: UnreadCountResponse | undefined;
};

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.user?.id) ?? "anonymous";
  const listKey = notificationKeys.list(userId);
  const unreadKey = notificationKeys.unread(userId);

  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onMutate: async (ids): Promise<Snapshot> => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.root });
      const lists = queryClient.getQueriesData<InfiniteData<NotificationListResponse>>({
        queryKey: listKey,
      });
      const unread = queryClient.getQueryData<UnreadCountResponse>(unreadKey);
      const idSet = ids ? new Set(ids) : null;
      const changed = lists.reduce(
        (count, [, data]) =>
          count +
          (data?.pages.reduce(
            (pageCount, page) =>
              pageCount +
              page.items.filter((item) => !item.readAt && (!idSet || idSet.has(item.id))).length,
            0,
          ) ?? 0),
        0,
      );

      queryClient.setQueriesData<InfiniteData<NotificationListResponse>>(
        { queryKey: listKey },
        (old) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => {
              if (item.readAt || (idSet && !idSet.has(item.id))) return item;
              return { ...item, readAt: new Date().toISOString() };
            }),
            unreadCount: idSet ? Math.max(0, page.unreadCount - changed) : 0,
          }));
          return { ...old, pages };
        },
      );
      queryClient.setQueryData<UnreadCountResponse>(unreadKey, (old) => ({
        unreadCount: ids ? Math.max(0, (old?.unreadCount ?? changed) - changed) : 0,
      }));
      return { lists, unread };
    },
    onError: (_error, _ids, snapshot) => {
      snapshot?.lists.forEach(([key, data]) => queryClient.setQueryData(key, data));
      queryClient.setQueryData(unreadKey, snapshot?.unread);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.root });
    },
  });
}

/** 一覧応答に同梱された未読数を、ナビゲーションのバッジへ反映する。 */
export function useSyncUnreadCount(unreadCount: number | undefined) {
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.user?.id) ?? "anonymous";
  useEffect(() => {
    if (unreadCount !== undefined) {
      queryClient.setQueryData(notificationKeys.unread(userId), { unreadCount });
    }
  }, [queryClient, unreadCount, userId]);
}
