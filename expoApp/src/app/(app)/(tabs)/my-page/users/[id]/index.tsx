import { UserProfileScreen } from "@/screens/UserProfileScreen";

/** マイページから開いたユーザープロフィール（マイページのスタックに積む）。 */
export default function Screen() {
  return <UserProfileScreen basePath="/my-page" />;
}
