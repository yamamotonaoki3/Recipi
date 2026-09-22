/**
 * backend接続不能の警告カード（Issue #318）。
 *
 * 画面上部に固定表示する非ブロッキングのカード（Modalは使わない）。
 * ログイン画面の「アプリ情報」リンク等、backendに依存しない操作を
 * 妨げないようにするため（Issue #317のbackend停止中でもアプリ情報を
 * 開けるという要件と、Modalによる画面全体のクリック遮断が衝突していた）。
 * 「後で確認」で閉じても、接続状態（backendReachability）自体は変わらない
 * ため、呼び出し側（ルートレイアウト）が状態表示バーとして引き続き警告を
 * 出す想定（このコンポーネント自体は自身を閉じるだけ）。
 */
import { Pressable, Text, View } from "react-native";

type ConnectivityWarningDialogProps = {
  visible: boolean;
  retrying: boolean;
  onRetry: () => void;
  onCheckUpdate: () => void;
  onDismiss: () => void;
  testID?: string;
};

export function ConnectivityWarningDialog({
  visible,
  retrying,
  onRetry,
  onCheckUpdate,
  onDismiss,
  testID = "connectivity-warning-dialog",
}: ConnectivityWarningDialogProps) {
  if (!visible) return null;

  return (
    <View testID={testID} className="gap-3 border-b border-neutral-200 bg-white p-4">
      <Text className="text-base font-bold text-neutral-900">サーバーに接続できません</Text>
      <Text className="text-sm text-neutral-600">
        現在サーバーに接続できないため、ログイン、レシピの登録・編集・取得などのデータ操作が利用できない可能性があります。すでに読み込み済みの画面は引き続き閲覧できる場合があります。
      </Text>
      <View className="flex-row flex-wrap justify-end gap-2">
        <Pressable
          testID={`${testID}-dismiss`}
          onPress={onDismiss}
          accessibilityRole="button"
          className="rounded-lg px-4 py-2"
        >
          <Text className="text-neutral-600">後で確認</Text>
        </Pressable>
        <Pressable
          testID={`${testID}-check-update`}
          onPress={onCheckUpdate}
          accessibilityRole="button"
          className="rounded-lg border border-neutral-300 px-4 py-2"
        >
          <Text className="text-neutral-700">更新を確認</Text>
        </Pressable>
        <Pressable
          testID={`${testID}-retry`}
          onPress={onRetry}
          disabled={retrying}
          accessibilityRole="button"
          className="rounded-lg bg-orange-500 px-4 py-2"
        >
          <Text className="font-semibold text-white">{retrying ? "再試行中…" : "再試行"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
