import { UserProfileScreen } from "@/screens/UserProfileScreen";

/** 履歴から開いたユーザープロフィール（履歴のスタックに積む）。 */
export default function Screen() {
  return <UserProfileScreen basePath="/history" />;
}
