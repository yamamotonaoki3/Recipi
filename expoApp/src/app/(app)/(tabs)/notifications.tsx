import { NotificationsScreen } from "@/screens/NotificationsScreen";

/** 通知は MVP では空状態固定のスタブなので、push 先が無く Stack も要らない。 */
export default function Screen() {
  return <NotificationsScreen />;
}
