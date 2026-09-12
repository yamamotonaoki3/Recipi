import { ConnectionsScreen } from "@/screens/ConnectionsScreen";

/** ホームから開いたユーザーのフォロー・フォロワー（ホームのスタックに積む）。 */
export default function Screen() {
  return <ConnectionsScreen basePath="/home" />;
}
