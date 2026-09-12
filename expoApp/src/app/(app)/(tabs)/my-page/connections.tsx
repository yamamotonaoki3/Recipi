import { ConnectionsScreen } from "@/screens/ConnectionsScreen";

/** マイページのメニュー「フォロー・フォロワー」（自分の一覧）。 */
export default function Screen() {
  return <ConnectionsScreen basePath="/my-page" self />;
}
