/**
 * 材料行の「レシピから選ぶ」ピッカー（screens/recipe-editor.md §材料行のレシピ参照）。
 *
 * `GET /users/me/recipes`（`q` で検索）から自分のレシピだけを出す。
 * 他人のレシピは対象外なので混ざらない。編集中のレシピ自身は選択不可。
 */
import { useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";

import { useMyRecipes } from "./hooks";

type RefRecipePickerProps = {
  visible: boolean;
  /** 編集中のレシピ ID（自己参照を防ぐため一覧から除外）。新規作成なら undefined。 */
  excludeRecipeId?: string;
  onSelect: (recipe: { id: string; title: string }) => void;
  onClose: () => void;
};

export function RefRecipePicker({
  visible,
  excludeRecipeId,
  onSelect,
  onClose,
}: RefRecipePickerProps) {
  const [q, setQ] = useState("");
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMyRecipes(q);

  const items = (data?.pages.flatMap((p) => p.items) ?? []).filter((r) => r.id !== excludeRecipeId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 gap-3 bg-white p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-neutral-900">レシピから選ぶ</Text>
          <Pressable testID="ref-picker-close" onPress={onClose} accessibilityRole="button">
            <Text className="text-neutral-500">閉じる</Text>
          </Pressable>
        </View>

        <TextInput
          testID="ref-picker-search"
          value={q}
          onChangeText={setQ}
          placeholder="レシピ・材料で検索"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-base"
        />

        {isPending && <ActivityIndicator />}
        {isError && <Text className="text-sm text-red-600">読み込みに失敗しました</Text>}
        {!isPending && !isError && items.length === 0 && (
          <Text className="text-sm text-neutral-500">選べるレシピがありません</Text>
        )}

        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <Pressable
              testID={`ref-picker-item-${item.id}`}
              onPress={() => onSelect({ id: item.id, title: item.title })}
              accessibilityRole="button"
              className="border-b border-neutral-100 py-3"
            >
              <Text className="text-base text-neutral-900">{item.title}</Text>
              {!item.isPublic && <Text className="text-xs text-neutral-400">非公開</Text>}
            </Pressable>
          )}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator /> : null}
        />
      </View>
    </Modal>
  );
}
