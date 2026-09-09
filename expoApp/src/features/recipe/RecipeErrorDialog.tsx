/**
 * 保存に失敗したことを知らせるポップアップ（Issue #63）。
 *
 * ## なぜダイアログが要るか
 *
 * 保存ボタンは固定ヘッダーにあるので画面のどこからでも押せるが、
 * エラーの表示先は「各欄の直下」と「ScrollView の先頭」しかない。
 * サムネイル欄が 4:3 で大きいこともあり、下の方で保存を押すと
 * **エラーがどこにも見えない**（＝「押しても何も起きない」ように見える）。
 *
 * そこで失敗時は必ず画面中央にポップアップを出し、
 * 「どこが」「なぜ」駄目なのかを並べる。各欄のインライン表示は
 * 閉じたあとの手掛かりとして残すので、この画面は上乗せの通知に徹する。
 *
 * 見た目は ConfirmDialog（components/ConfirmDialog.tsx）と揃えてあるが、
 * あちらは「実行 / キャンセル」の確認用で意味が違うため共用しない。
 */
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import type { FormErrorEntry } from "./collectFormErrors";

/**
 * 一覧に出す最大件数。全部出すとダイアログが画面を覆ってしまい、
 * かえって「まず何を直すか」が分からなくなるため先頭だけ見せる。
 */
const MAX_VISIBLE = 5;

type RecipeErrorDialogProps = {
  visible: boolean;
  /** 欄に紐づくエラー。通信エラーなど欄に紐づかない失敗では空配列。 */
  entries: FormErrorEntry[];
  /** 一覧の代わり、または補足として出す 1 行メッセージ。 */
  message: string | null;
  onClose: () => void;
  /** 「最初のエラーへ移動」。エントリがあるときだけボタンを出す。 */
  onJumpToFirst: () => void;
  testID?: string;
};

export function RecipeErrorDialog({
  visible,
  entries,
  message,
  onClose,
  onJumpToFirst,
  testID,
}: RecipeErrorDialogProps) {
  const visibleEntries = entries.slice(0, MAX_VISIBLE);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View testID={testID} className="w-full max-w-sm gap-3 rounded-xl bg-white p-5">
          <Text className="text-lg font-bold text-neutral-900">保存できませんでした</Text>

          {message && <Text className="text-sm text-neutral-600">{message}</Text>}

          {visibleEntries.length > 0 && (
            // 件数が多いときにボタンが画面外へ押し出されないよう、一覧側だけ
            // 高さを制限してスクロールさせる。
            <ScrollView className="max-h-60" contentContainerClassName="gap-2">
              {visibleEntries.map((entry) => (
                <View key={entry.anchorKey}>
                  <Text className="text-sm font-semibold text-neutral-900">{entry.location}</Text>
                  <Text className="text-sm text-red-600">{entry.message}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          {hiddenCount > 0 && (
            <Text className="text-xs text-neutral-500">
              ほか {hiddenCount} 件のエラーがあります
            </Text>
          )}

          <View className="mt-2 flex-row justify-end gap-2">
            <Pressable
              testID={testID ? `${testID}-close` : undefined}
              onPress={onClose}
              accessibilityRole="button"
              className="rounded-lg px-4 py-2"
            >
              <Text className="text-neutral-600">閉じる</Text>
            </Pressable>
            {entries.length > 0 && (
              <Pressable
                testID={testID ? `${testID}-jump` : undefined}
                onPress={onJumpToFirst}
                accessibilityRole="button"
                className="rounded-lg bg-orange-500 px-4 py-2"
              >
                <Text className="font-semibold text-white">最初のエラーへ移動</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
