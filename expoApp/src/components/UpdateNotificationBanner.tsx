/**
 * GitHub Releaseの新版通知バナー（Issue #318）。
 *
 * 通常のサーバー通知一覧（`features/notification`）とは別系統
 * （GitHubから取得した更新状態として扱う）。「更新する」の実際の
 * インストーラー連携はStage 3（Issue #319）で実装する。
 */
import { Pressable, Text, View } from "react-native";

import type { ReleaseInfo } from "@/features/appUpdate/types";

type UpdateNotificationBannerProps = {
  release: ReleaseInfo;
  onUpdate: () => void;
  onDismiss: () => void;
  onViewRelease: () => void;
  testID?: string;
};

export function UpdateNotificationBanner({
  release,
  onUpdate,
  onDismiss,
  onViewRelease,
  testID = "update-notification-banner",
}: UpdateNotificationBannerProps) {
  return (
    <View testID={testID} className="gap-2 bg-neutral-800 px-4 py-3">
      <Text className="text-sm font-semibold text-white">
        新しいバージョン（{release.version}）があります
      </Text>
      <View className="flex-row flex-wrap gap-4">
        <Pressable testID={`${testID}-update`} onPress={onUpdate} accessibilityRole="button">
          <Text className="text-sm font-semibold text-orange-400">更新する</Text>
        </Pressable>
        <Pressable
          testID={`${testID}-view-release`}
          onPress={onViewRelease}
          accessibilityRole="button"
        >
          <Text className="text-sm text-neutral-200">リリース内容を見る</Text>
        </Pressable>
        <Pressable testID={`${testID}-dismiss`} onPress={onDismiss} accessibilityRole="button">
          <Text className="text-sm text-neutral-400">後で</Text>
        </Pressable>
      </View>
    </View>
  );
}
