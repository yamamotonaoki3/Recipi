/**
 * 未ログイン用のスタック（ログイン / サインアップ / パスワードリセット）。
 * Expo Router の「ルートグループ」（括弧付きディレクトリ）はパスに
 * 現れず、画面をグループ分けするためだけに使う。
 *
 * ここには認可ゲートを付けない（未ログインでも見られる画面群のため）。
 */
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
