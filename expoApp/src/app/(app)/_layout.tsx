/**
 * 保護ルート（ログイン必須の画面群）。
 *
 * `useProtectedRoute` を呼ぶだけで、配下の全画面が「未ログインならログイン
 * 画面へ差し替える」対象になる（navigation.md の認可ゲート要件）。
 *
 * 構造（Issue #42）:
 * - `(tabs)` … 5 destination のメインシェル（ホーム / 履歴 / ＋ / 通知 / マイページ）。
 *   グループなので URL には出ず、ホームは `/` のまま。
 * - それ以外（レシピ詳細・自分のレシピ一覧・プロフィール編集）は、この Stack に
 *   **タブの上へ push** される。タブを持つシェルの上に重ねたいので、タブ側ではなく
 *   ここに置く（navigation.md のナビゲーション階層図）。
 * - レシピ作成 / 編集は screens/recipe-editor.md に従いモーダルで開く。
 */
import { Stack } from "expo-router";

import { useProtectedRoute } from "@/features/auth/useProtectedRoute";

export default function AppLayout() {
  useProtectedRoute();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="recipes/new" options={{ presentation: "modal" }} />
      <Stack.Screen name="recipes/[id]/edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
