/**
 * 保護ルート（ログイン必須の画面群）。
 *
 * `useProtectedRoute` を呼ぶだけで、配下の全画面が「未ログインならログイン
 * 画面へ差し替える」対象になる（navigation.md の認可ゲート要件）。
 *
 * 本格的な5タブシェル（ホーム/履歴/＋/通知/マイページ）は Issue #42 で
 * 実装する。Issue #36 の時点では、この配下に Phase 0 のプレースホルダー
 * 画面（旧 `app/index.tsx`）と、プロフィール編集画面だけを置く。
 */
import { Stack } from "expo-router";

import { useProtectedRoute } from "@/features/auth/useProtectedRoute";

export default function AppLayout() {
  useProtectedRoute();
  return <Stack screenOptions={{ headerShown: false }} />;
}
