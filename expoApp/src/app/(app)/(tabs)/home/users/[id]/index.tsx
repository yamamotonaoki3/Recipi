import { UserProfileScreen } from "@/screens/UserProfileScreen";

/** ホームから開いたユーザープロフィール（ホームのスタックに積む）。 */
export default function Screen() {
  return <UserProfileScreen basePath="/home" />;
}
