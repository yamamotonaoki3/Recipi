/**
 * スプラッシュ画面。アプリ起動時に必ず最初に表示される（画面遷移の入口）。
 *
 * 自動ログイン復元自体はルートレイアウト（`app/_layout.tsx`）が起動時に
 * 一度だけ実行する（保護ルートへの直接ディープリンクでも復元が走るように
 * するため）。ここではその結果（セッションストアの `hydrated` /
 * `isAuthenticated`）を見て、ホーム（保護ルート配下）かログイン画面へ
 * `router.replace` で差し替えるだけ（戻るボタンでスプラッシュに戻れない
 * ようにするため `push` ではなく `replace`）。
 */
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useSession } from "@/store/session";

export default function SplashScreen() {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (isAuthenticated) {
      router.replace("/home");
    } else {
      router.replace("/(auth)/login");
    }
  }, [hydrated, isAuthenticated, router]);

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
      <Text className="text-2xl font-bold text-neutral-900">Recipi</Text>
      <ActivityIndicator />
    </View>
  );
}
