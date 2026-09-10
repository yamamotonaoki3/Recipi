import { HomeScreen } from "@/screens/HomeScreen";

/** ホームのルート。push 先を同じ destination のスタック内に収める（basePath）。 */
export default function Screen() {
  return <HomeScreen basePath="/home" />;
}
