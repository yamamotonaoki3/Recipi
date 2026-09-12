/**
 * フィード / 閲覧履歴用のレシピカード（screens/components.md §レシピカード）。
 *
 * 既存の `RecipeCard` は「自分のレシピ一覧」用で、`RecipeSummary`
 * （`isPublic` / `createdAt`）しか持たず投稿者を出さない。フィードと履歴は
 * **他人のレシピが並ぶ**ので、投稿者名とお気に入り数を出すこちらを使う
 * （`RecipeFeedItem` = id / title / thumbnailUrl / author / favoriteCount）。
 *
 * `HistoryItem` は `RecipeFeedItem` ＋ `viewedAt` なのでそのまま渡せる。
 */
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import type { RecipeFeedItem } from "@/features/feed/api";

type FeedRecipeCardProps = {
  recipe: RecipeFeedItem;
  onPress: () => void;
  testID?: string;
};

export function FeedRecipeCard({ recipe, onPress, testID }: FeedRecipeCardProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row gap-3 rounded-xl border border-neutral-200 bg-white p-3"
    >
      <View className="h-16 w-16 items-center justify-center rounded-lg bg-neutral-100">
        {recipe.thumbnailUrl ? (
          <Image
            testID={testID ? `${testID}-thumbnail` : undefined}
            source={{ uri: recipe.thumbnailUrl }}
            style={{ width: 64, height: 64, borderRadius: 8 }}
            contentFit="cover"
          />
        ) : (
          <Text className="text-xs text-neutral-400">No Image</Text>
        )}
      </View>

      <View className="flex-1 justify-center gap-1">
        <Text numberOfLines={2} className="text-base font-semibold text-neutral-900">
          {recipe.title}
        </Text>
        <View className="flex-row items-center gap-2">
          {/* 投稿者は「アバター ＋ 表示名」（screens/components.md §レシピカード）。
              未設定なら頭文字の丸になる（Avatar 部品の中で出し分ける）。 */}
          <Avatar
            url={recipe.author.avatarUrl}
            displayName={recipe.author.displayName}
            size={16}
            testID={testID ? `${testID}-avatar` : undefined}
          />
          <Text
            testID={testID ? `${testID}-author` : undefined}
            numberOfLines={1}
            className="flex-1 text-xs text-neutral-500"
          >
            {recipe.author.displayName}
          </Text>
          {/* お気に入り数は Phase 6 まで 0 のままだが、サーバーの値をそのまま出す
              （0 固定にせず、機能が入った時点で自動的に正しくなるようにする）。 */}
          <Text className="text-xs text-neutral-400">♡ {recipe.favoriteCount}</Text>
        </View>
      </View>
    </Pressable>
  );
}
