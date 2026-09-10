/**
 * マイページ destination のスタック（screens/navigation.md）。
 * 自分のレシピ一覧・プロフィール編集・そこから開く詳細をこの中に積む。
 */
import { Stack } from "expo-router";

export default function MyPageStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
