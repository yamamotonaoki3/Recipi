/**
 * オフラインの案内（Issue #133）。
 *
 * TanStack Query は、既定（`networkMode: "online"`）ではオフラインのあいだ読み込みも送信
 * （♡・フォロー・感想・保存）も失敗にせず「一時停止」し、オンラインに戻ると自動でやり直す
 * （lessons #132-2）。そのままでは、ボタンが送信中のまま止まっていても理由が分からない。
 * そこでオフラインのあいだだけ、画面上部に理由と「自動でやり直す」ことを出す。
 *
 * オンラインかどうかは TanStack Query の `onlineManager` が持っているので、それを購読する
 * （同じ判定で一時停止しているので、案内と実際の振る舞いがずれない）。
 */
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** オンラインかどうかを購読する（変わったら再描画する）。 */
function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function OfflineBanner() {
  const isOnline = useIsOnline();
  const insets = useSafeAreaInsets();
  if (isOnline) return null;

  return (
    <View
      testID="offline-banner"
      accessibilityRole="alert"
      className="bg-neutral-800 px-4 py-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <Text className="text-center text-sm text-white">
        オフラインです。つながると自動で読み込み・送信します
      </Text>
    </View>
  );
}
