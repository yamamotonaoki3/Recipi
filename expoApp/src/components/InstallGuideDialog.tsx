/**
 * インストーラー案内ダイアログ（Issue #319「更新する」）。
 *
 * 未署名配布であることの注意喚起と、実際の配布URL起動を行う。
 * URL起動自体の失敗（ネットワーク不通・ブラウザ起動不可等）は検出して
 * 再試行を促せるが、その後のダウンロード完了・インストール実行は
 * OS/ブラウザの責務でアプリからは観測できない（案内文で明示する）。
 */
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

export type InstallGuideDialogProps = {
  visible: boolean;
  /** 「続ける」で実際にURLを開く。成功/失敗を返す。 */
  onConfirm: () => Promise<{ ok: boolean }>;
  onClose: () => void;
  testID?: string;
};

export function InstallGuideDialog({
  visible,
  onConfirm,
  onClose,
  testID = "install-guide-dialog",
}: InstallGuideDialogProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);

  async function handleConfirm() {
    setError(false);
    setStarting(true);
    const result = await onConfirm();
    setStarting(false);
    if (!result.ok) setError(true);
  }

  function handleClose() {
    setError(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View testID={testID} className="w-full max-w-sm gap-3 rounded-xl bg-white p-5">
          <Text className="text-lg font-bold text-neutral-900">更新のインストール</Text>
          <Text className="text-sm text-neutral-600">
            このアプリは未署名で配布しています。ダウンロード・インストール時にOSが「発行元不明」の警告を出すことがありますが、内容を確認のうえ許可してください。ダウンロードとインストールの完了はご自身で確認してください（このアプリからは見届けられません）。
          </Text>
          {error && (
            <Text testID={`${testID}-error`} className="text-sm text-red-600">
              開けませんでした。もう一度お試しください
            </Text>
          )}
          <View className="mt-2 flex-row justify-end gap-2">
            <Pressable
              testID={`${testID}-cancel`}
              onPress={handleClose}
              accessibilityRole="button"
              className="rounded-lg px-4 py-2"
            >
              <Text className="text-neutral-600">キャンセル</Text>
            </Pressable>
            <Pressable
              testID={`${testID}-confirm`}
              onPress={() => void handleConfirm()}
              disabled={starting}
              accessibilityRole="button"
              className="rounded-lg bg-orange-500 px-4 py-2"
            >
              <Text className="font-semibold text-white">
                {starting ? "開いています…" : error ? "もう一度開く" : "続ける"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
