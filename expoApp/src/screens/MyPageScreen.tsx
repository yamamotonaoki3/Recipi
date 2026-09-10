/**
 * マイページ（screens/my-page.md）。
 *
 * MVP（Phase 4）のスコープは **表示名 ＋ ログアウト**、それに Phase 1・2 で
 * 既に使える「自分のレシピ一覧」「プロフィール編集」への導線まで。
 * アバター・フォロー数・「フォロー・フォロワー」は Phase 5、アカウント削除は
 * Phase 9 なので出さない（roadmap.md「MVP ライン」）。
 */
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLogout } from "@/features/auth/useLogout";
import { useSession } from "@/store/session";

export function MyPageScreen({ basePath }: { basePath: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useSession((s) => s.user);
  const logout = useLogout();

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="border-b border-neutral-200 px-4 py-3">
        <Text className="text-lg font-bold text-neutral-900">マイページ</Text>
      </View>

      {/* プロフィール概要（MVP は表示名のみ）。 */}
      <View className="px-4 py-5">
        <Text testID="my-page-display-name" className="text-xl font-semibold text-neutral-900">
          {user?.displayName ?? ""}
        </Text>
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
