/** 通知一覧（screens/notifications.md、Issue #117）。 */
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationItem } from "@/components/NotificationItem";
import type { NotificationItem as NotificationItemData } from "@/features/notification/api";
import {
  useMarkNotificationsRead,
  useNotifications,
  useSyncUnreadCount,
} from "@/features/notification/hooks";

export function NotificationsScreen({ basePath = "/notifications" }: { basePath?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const unreadCount = notifications.data?.pages[0]?.unreadCount;
  useSyncUnreadCount(unreadCount);

  function openNotification(item: NotificationItemData) {
    if (!item.readAt) markRead.mutate([item.id]);
    if (item.type === "followed") {
      router.push(`${basePath}/users/${item.actor.id}` as never);
    } else if (item.recipe) {
      router.push(`${basePath}/recipes/${item.recipe.id}` as never);
    }
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3">
        <Text className="text-lg font-bold text-neutral-900">通知</Text>
        <View className="flex-row items-center gap-4">
          {Platform.OS === "web" && (
            <Pressable
              testID="notifications-refresh"
              onPress={() => void notifications.refetch()}
              disabled={notifications.isRefetching}
              accessibilityRole="button"
            >
              <Text className="text-orange-600">更新</Text>
            </Pressable>
          )}
          <Pressable
            testID="notifications-read-all"
            onPress={() => markRead.mutate(undefined)}
            disabled={!unreadCount || markRead.isPending}
            accessibilityRole="button"
          >
            <Text className={!unreadCount ? "text-neutral-300" : "text-orange-600"}>
              すべて既読
            </Text>
          </Pressable>
        </View>
      </View>

      {markRead.isError && (
        <View testID="notifications-read-error" className="bg-red-50 px-4 py-2">
          <Text className="text-sm text-red-700">
            既読状態を更新できませんでした。通信環境を確認して、もう一度お試しください。
          </Text>
        </View>
      )}

      {notifications.isPending ? (
        <View testID="notifications-loading" className="gap-3 p-4">
          {[0, 1, 2, 3].map((index) => (
            <View key={index} className="flex-row gap-3 rounded-lg bg-neutral-50 p-4">
              <View className="h-11 w-11 rounded-full bg-neutral-200" />
              <View className="flex-1 gap-2">
                <View className="h-4 rounded bg-neutral-200" />
                <View className="h-3 w-24 rounded bg-neutral-200" />
              </View>
            </View>
          ))}
        </View>
      ) : notifications.isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-neutral-600">読み込みに失敗しました</Text>
          <Pressable
            testID="notifications-retry"
            onPress={() => void notifications.refetch()}
            accessibilityRole="button"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          >
            <Text className="text-neutral-700">再試行</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="notifications-list"
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationItem
              item={item}
              onPress={() => openNotification(item)}
              disabled={!item.readAt && markRead.isPending}
            />
          )}
          ListEmptyComponent={
            <Text testID="notifications-empty" className="mt-10 text-center text-neutral-500">
              通知はまだありません
            </Text>
          }
          refreshControl={
            <RefreshControl
              refreshing={notifications.isRefetching}
              onRefresh={() => void notifications.refetch()}
            />
          }
          onEndReached={() => {
            if (notifications.hasNextPage && !notifications.isFetchingNextPage) {
              void notifications.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            notifications.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null
          }
        />
      )}
    </View>
  );
}
