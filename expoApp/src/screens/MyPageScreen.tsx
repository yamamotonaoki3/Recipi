/**
 * マイページ（screens/my-page.md）。
 *
 * プロフィール概要（アバター ＋ 表示名）と、アカウント関連メニューへの入口。
 * 概要は `GET /users/{自分の ID}` で取る（Issue #94）。
 * フォロー数・「フォロー・フォロワー」は F2 で追加する。
 */
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { useLogout } from "@/features/auth/useLogout";
import { useMyProfile } from "@/features/profile/hooks";
import { useSession } from "@/store/session";

export function MyPageScreen({ basePath }: { basePath: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useSession((s) => s.user);
  const profileQuery = useMyProfile();
  const logout = useLogout();

  // 取得前はセッションの表示名を出しておく（空白の画面にしない）。
  const displayName = profileQuery.data?.displayName ?? user?.displayName ?? "";

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="border-b border-neutral-200 px-4 py-3">
        <Text className="text-lg font-bold text-neutral-900">マイページ</Text>
      </View>

      {/* プロフィール概要 */}
      <View className="flex-row items-center gap-4 px-4 py-5">
        <Avatar
          url={profileQuery.data?.avatarUrl}
          displayName={displayName}
          size={56}
          testID="my-page-avatar"
        />
        <View className="flex-1 gap-1">
          <Text testID="my-page-display-name" className="text-xl font-semibold text-neutral-900">
            {displayName}
          </Text>
          {/* 概要の取得に失敗してもメニューは使えるようにする（my-page.md §4）。 */}
          {profileQuery.missingUser ? (
            <Text className="text-sm text-neutral-500">
              読み込みに失敗しました。ログインし直してください。
            </Text>
          ) : profileQuery.isError ? (
            <View className="flex-row items-center gap-3">
              <Text className="text-sm text-neutral-500">読み込みに失敗しました</Text>
              <Pressable
                testID="my-page-retry"
                onPress={() => void profileQuery.refetch()}
                accessibilityRole="button"
              >
                <Text className="text-sm text-blue-600">再試行</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      {/* メニュー */}
      <View className="border-t border-neutral-200">
        <Pressable
          testID="my-page-my-recipes"
          onPress={() => router.push(`${basePath}/my-recipes` as never)}
          accessibilityRole="button"
          className="border-b border-neutral-200 px-4 py-4"
        >
          <Text className="text-base text-neutral-800">自分のレシピ一覧</Text>
        </Pressable>

        <Pressable
          testID="my-page-profile-edit"
          onPress={() => router.push(`${basePath}/profile-edit` as never)}
          accessibilityRole="button"
          className="border-b border-neutral-200 px-4 py-4"
        >
          <Text className="text-base text-neutral-800">プロフィール編集</Text>
        </Pressable>

        <Pressable
          testID="my-page-logout"
          onPress={() => logout.mutate()}
          disabled={logout.isPending}
          accessibilityRole="button"
          className="border-b border-neutral-200 px-4 py-4"
        >
          <Text className="text-base text-red-600">
            {logout.isPending ? "ログアウト中…" : "ログアウト"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
