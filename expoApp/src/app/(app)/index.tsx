/**
 * ホーム（仮）。Phase 0 のプレースホルダー画面を保護ルート配下に移設した。
 * 本格的な5タブシェルは Issue #42 で実装する。
 *
 * Issue #36 では、ログイン後の着地点として最低限「ログアウトできる」
 * 「プロフィール編集へ行ける」ことだけを確認できればよい。
 */
import { Link } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useHealth } from "@/api/health";
import { useLogout } from "@/features/auth/useLogout";
import { useSession } from "@/store/session";

export default function HomeScreen() {
  const { data, isPending, isError } = useHealth();
  const logout = useLogout();
  const user = useSession((s) => s.user);

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
      <Text className="text-2xl font-bold text-neutral-900">Recipi</Text>
      <Text className="text-neutral-500">
        {user ? `ようこそ、${user.displayName} さん` : "ホーム（仮）"}
      </Text>

      <View className="mt-6 items-center gap-1">
        <Text className="text-xs uppercase tracking-wide text-neutral-400">backend /healthz</Text>
        {isPending && <ActivityIndicator />}
        {isError && <Text className="text-red-600">接続できません</Text>}
        {data && (
          <Text className="text-green-700">
            {data.status} ({data.env})
          </Text>
        )}
      </View>

      <Link href="/(app)/profile-edit" className="mt-6 text-sm text-neutral-600">
        プロフィール編集
      </Link>

      <Pressable
        testID="home-logout"
        onPress={() => logout.mutate()}
        disabled={logout.isPending}
        className="mt-2 rounded-lg border border-neutral-300 px-4 py-2"
        accessibilityRole="button"
      >
        <Text className="text-neutral-700">
          {logout.isPending ? "ログアウト中…" : "ログアウト"}
        </Text>
      </Pressable>
    </View>
  );
}
