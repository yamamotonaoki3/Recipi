/**
 * アプリバーの「戻る」ボタンの中身（Issue #144）。
 *
 * 以前は「← 戻る」を文字だけで出していた。矢印を lucide の `ChevronLeft` に
 * 置き換え、各画面で同じ見た目になるよう部品にまとめた。
 * 押す処理（Pressable・testID）は各画面が持つので、ここは見た目だけ。
 */
import { ChevronLeft } from "lucide-react-native";
import { Text, View } from "react-native";

import { Icon } from "@/components/Icon";

export function BackLabel() {
  return (
    <View className="flex-row items-center">
      <Icon as={ChevronLeft} size={20} />
      <Text className="text-neutral-500">戻る</Text>
    </View>
  );
}
