/** 通知一覧の1行（features/notification.md §2）。 */
import { Pressable, Text, View } from "react-native";

import { Avatar } from "./Avatar";
import type { NotificationItem as NotificationItemData } from "@/features/notification/api";
import { notificationDate, notificationMessage } from "@/features/notification/format";

export function NotificationItem({
  item,
  onPress,
  disabled = false,
}: {
  item: NotificationItemData;
  onPress: () => void;
  disabled?: boolean;
}) {
  const unread = item.readAt === null;
  return (
    <Pressable
      testID={`notification-${item.id}`}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? "未読、" : ""}${notificationMessage(item)}`}
      className={`flex-row gap-3 border-b border-neutral-100 p-4 ${unread ? "bg-orange-50" : "bg-white"} ${disabled ? "opacity-60" : ""}`}
    >
      <Avatar
        url={item.actor.avatarUrl}
        displayName={item.actor.displayName}
        size={44}
        testID={`notification-${item.id}-avatar`}
      />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-start gap-2">
          {unread && (
            <View
              testID={`notification-${item.id}-unread`}
              className="mt-2 h-2 w-2 rounded-full bg-orange-500"
            />
          )}
          <Text className="min-w-0 flex-1 text-sm leading-5 text-neutral-800">
            {notificationMessage(item)}
          </Text>
        </View>
        <Text className="text-xs text-neutral-400">{notificationDate(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}
