/**
 * 履歴 destination のスタック（screens/navigation.md）。詳細は home/_layout.tsx と同じ。
 */
import { Stack } from "expo-router";

export default function HistoryStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
