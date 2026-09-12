/**
 * マイページ（screens/my-page.md）。
 *
 * プロフィール概要（アバター ＋ 表示名 ＋ フォロー数 / フォロワー数）と、
 * アカウント関連メニューへの入口。概要は `GET /users/{自分の ID}` で取る（Issue #94）。
 * フォロー数・「フォロー・フォロワー」は Issue #96 で追加した。
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

  function openConnections(tab?: "following" | "followers") {
    router.push(`${basePath}/connections${tab ? `?tab=${tab}` : ""}` as never);
  }

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

          {/* フォロー数 / フォロワー数。タップでフォロー・フォロワー画面の該当タブへ
              （my-page.md §3）。取得できるまでは出さない（0 と誤解させないため）。 */}
          {profileQuery.data && (
            <View className="flex-row gap-4">
              <Pressable
                testID="my-page-following"
                onPress={() => openConnections("following")}
                accessibilityRole="button"
              >
                <Text className="text-sm text-neutral-600">
                  <Text className="font-semibold text-neutral-900">
                    {profileQuery.data.followingCount}
                  </Text>{" "}
                  フォロー
                </Text>
              </Pressable>
              <Pressable
                testID="my-page-followers"
                onPress={() => openConnections("followers")}
                accessibilityRole="button"
              >
                <Text className="text-sm text-neutral-600">
                  <Text className="font-semibold text-neutral-900">
                    {profileQuery.data.followerCount}
                  </Text>{" "}
                  フォロワー
                </Text>
              </Pressable>
            </View>
          )}

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

      {/* メニュー（並びは my-page.md §3） */}
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
          testID="my-page-connections"
          onPress={() => openConnections()}
          accessibilityRole="button"
          className="border-b border-neutral-200 px-4 py-4"
        >
          <Text className="text-base text-neutral-800">フォロー・フォロワー</Text>
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
