/**
 * ルートレイアウト。Expo Router は `src/app/` のファイル構成を
 * そのまま画面遷移にする（ファイルベースルーティング）。
 * `_layout.tsx` は全画面の「外枠」で、ここでプロバイダを差し込む。
 *
 * Phase 0 は画面 1 枚だけ。Phase 1 以降でスプラッシュ / ログイン /
 * タブ（ボトムナビ）などを足していく。
 */
import { Stack } from "expo-router";

import { QueryProvider } from "@/providers/QueryProvider";
import "../global.css"; // NativeWind（className）を有効にする

export default function RootLayout() {
  return (
    <QueryProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryProvider>
  );
}
