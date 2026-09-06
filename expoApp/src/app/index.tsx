/**
 * アプリのエントリ（`/`）。常にスプラッシュへリダイレクトするだけの薄い画面。
 * 実際の「保存済みトークンで自動ログインするか」の判定は `app/splash.tsx`
 * （`useAuthRefresh`）が行う。
 */
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/splash" />;
}
