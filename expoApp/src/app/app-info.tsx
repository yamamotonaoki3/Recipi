/**
 * ルートグループ外（`(auth)` / `(app)` どちらにも属さない）に置く。
 * ログイン画面（未認証）からも、マイページ等（認証済み）からも開ける
 * ようにするため（Issue #317）。
 */
import { AppInfoScreen } from "@/screens/AppInfoScreen";

export default function Screen() {
  return <AppInfoScreen />;
}
