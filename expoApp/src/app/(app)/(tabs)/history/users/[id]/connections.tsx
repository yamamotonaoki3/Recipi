import { ConnectionsScreen } from "@/screens/ConnectionsScreen";

/** 履歴から開いたユーザーのフォロー・フォロワー（履歴のスタックに積む）。 */
export default function Screen() {
  return <ConnectionsScreen basePath="/history" />;
}
