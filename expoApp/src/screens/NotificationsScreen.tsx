/**
 * 通知（screens/notifications.md）。
 *
 * 通知そのものは Phase 8 の機能。MVP（Phase 4）では **destination の枠だけ**を
 * 用意して、空状態を固定で出すスタブにする。`notifications` テーブルも API も
 * バッジも作らない（roadmap.md「MVP ライン」）。
 */
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function NotificationsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="border-b border-neutral-200 px-4 py-3">
        <Text className="text-lg font-bold text-neutral-900">通知</Text>
      </View>
      <View className="flex-1 items-center justify-center p-6">
        <Text testID="notifications-empty" className="text-center text-neutral-500">
          通知はまだありません
        </Text>
      </View>
    </View>
  );
}
