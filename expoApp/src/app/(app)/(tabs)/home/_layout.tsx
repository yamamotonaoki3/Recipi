/**
 * ホーム destination のスタック（screens/navigation.md）。
 *
 * destination ごとに独立したスタックを持たせることで、レシピ詳細を push しても
 * **ナビゲーションバーが出たまま**になり、タブを切り替えても各タブの位置が保たれる。
 */
import { Stack } from "expo-router";

export default function HomeStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
