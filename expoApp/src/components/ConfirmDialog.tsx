/**
 * 破壊的操作の前に出す確認モーダル（screens/components.md §確認ダイアログ）。
 *
 * レシピ削除・「編集内容を破棄しますか？」など複数箇所で再利用する。
 * `visible` を親が持ち、「実行」「キャンセル」で親へ通知するだけの制御された部品。
 */
import { Modal, Pressable, Text, View } from "react-native";

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  /** 「実行」ボタンのラベル（既定「実行」）。 */
  confirmLabel?: string;
  /** 破壊的操作なら true で赤くする（既定 true）。 */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "実行",
  destructive = true,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View testID={testID} className="w-full max-w-sm gap-3 rounded-xl bg-white p-5">
          <Text className="text-lg font-bold text-neutral-900">{title}</Text>
          <Text className="text-sm text-neutral-600">{message}</Text>
          <View className="mt-2 flex-row justify-end gap-2">
            <Pressable
              testID={testID ? `${testID}-cancel` : undefined}
              onPress={onCancel}
              accessibilityRole="button"
              className="rounded-lg px-4 py-2"
            >
              <Text className="text-neutral-600">キャンセル</Text>
            </Pressable>
            <Pressable
              testID={testID ? `${testID}-confirm` : undefined}
              onPress={onConfirm}
              accessibilityRole="button"
              className={`rounded-lg px-4 py-2 ${destructive ? "bg-red-600" : "bg-orange-500"}`}
            >
              <Text className="font-semibold text-white">{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
