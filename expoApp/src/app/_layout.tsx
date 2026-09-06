/**
 * ルートレイアウト。Expo Router は `src/app/` のファイル構成を
 * そのまま画面遷移にする（ファイルベースルーティング）。
 * `_layout.tsx` は全画面の「外枠」で、ここでプロバイダを差し込む。
 *
 * 実際の画面分岐（未ログイン用の `(auth)` / ログイン必須の `(app)`）は
 * それぞれのグループの `_layout.tsx` が担当する。ここでは共通の
 * プロバイダ（TanStack Query）と 1 本の Stack を用意するだけ。
 */
import { Stack } from "expo-router";

import { useAuthRefresh } from "@/features/auth/useAuthRefresh";
import { QueryProvider } from "@/providers/QueryProvider";
import "../global.css"; // NativeWind（className）を有効にする

// ここで（画面ではなくルートレイアウトで）自動ログイン復元を開始する。
// splash.tsx 経由の起動だけでなく、保護ルートへのディープリンクで
// 直接 (app)/... がマウントされるケースでも、必ず一度だけ復元が走り
// `hydrated` が立つようにするため（useProtectedRoute 参照）。
function AuthBootstrap() {
  useAuthRefresh();
  return null;
}

export default function RootLayout() {
  return (
    <QueryProvider>
      <AuthBootstrap />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryProvider>
  );
}
