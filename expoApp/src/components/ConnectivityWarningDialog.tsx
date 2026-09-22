/**
 * backend接続不能の警告ダイアログ（Issue #318）。
 *
 * `ConfirmDialog.tsx`のレイアウトを踏襲しつつ、3ボタン（再試行・更新を確認・
 * 後で確認）を持つ。「後で確認」で閉じても、接続状態（backendReachability）
 * 自体は変わらないため、呼び出し側（ルートレイアウト）が状態表示バーとして
 * 引き続き警告を出す想定（このコンポーネント自体はモーダルを閉じるだけ）。
 */
import { Modal, Pressable, Text, View } from "react-native";

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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View testID={testID} className="w-full max-w-sm gap-3 rounded-xl bg-white p-5">
          <Text className="text-lg font-bold text-neutral-900">サーバーに接続できません</Text>
          <Text className="text-sm text-neutral-600">
            現在サーバーに接続できないため、ログイン、レシピの登録・編集・取得などのデータ操作が利用できない可能性があります。すでに読み込み済みの画面は引き続き閲覧できる場合があります。
          </Text>
          <View className="mt-2 flex-row flex-wrap justify-end gap-2">
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
      </View>
    </Modal>
  );
}
