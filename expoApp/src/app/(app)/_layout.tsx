/**
 * 保護ルート（ログイン必須の画面群）。
 *
 * `useProtectedRoute` を呼ぶだけで、配下の全画面が「未ログインならログイン
 * 画面へ差し替える」対象になる（navigation.md の認可ゲート要件）。
 *
 * 本格的な5タブシェル（ホーム/履歴/＋/通知/マイページ）は Issue #42 で
 * 実装する。現時点では Phase 0 のプレースホルダー画面（`app/index.tsx`）と、
 * プロフィール編集、そして Issue #38 のレシピ画面（一覧 / 詳細 / 作成 / 編集）を
 * この配下に置く。作成・編集は screens/recipe-editor.md に従いモーダルで開く。
 */
import { Stack } from "expo-router";

import { useProtectedRoute } from "@/features/auth/useProtectedRoute";

export default function AppLayout() {
  useProtectedRoute();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="recipes/new" options={{ presentation: "modal" }} />
      <Stack.Screen name="recipes/[id]/edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
