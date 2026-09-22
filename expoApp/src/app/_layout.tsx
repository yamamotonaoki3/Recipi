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
import { SafeAreaProvider } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useAuthRefresh } from "@/features/auth/useAuthRefresh";
import { AppUpdateGate } from "@/features/appUpdate/AppUpdateGate";
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
    // `SafeAreaProvider` は各画面が `useSafeAreaInsets()` で
    // ステータスバー / ナビゲーションバーの領域（inset）を知るために必要。
    // Android 15（targetSdk 35）以降は edge-to-edge が強制され、アプリの
    // 描画領域がシステムバーの下まで広がる。inset を考慮しないと画面上端の
    // 固定ヘッダーがステータスバーに隠れ、**見た目が崩れるだけでなく
    // アクセシビリティツリーからも剪定されて TalkBack や E2E から
    // 到達できなくなる**（Issue #57 / #58 で実際に発生）。
    <SafeAreaProvider>
      <QueryProvider>
        <AuthBootstrap />
        {/* オフラインのときだけ上部に出る案内（Issue #133）。オンラインかどうかは
            TanStack Query が知っているので QueryProvider の内側に置く。ログイン前の
            画面にも出るよう、ルートに 1 つだけ置く。 */}
        <OfflineBanner />
        {/* 更新通知・backend接続不能警告（Issue #318）。OfflineBannerと同じく
            未ログイン画面にも出るよう、ルートに1つだけ置く。 */}
        <AppUpdateGate />
        <Stack screenOptions={{ headerShown: false }} />
      </QueryProvider>
    </SafeAreaProvider>
  );
}
