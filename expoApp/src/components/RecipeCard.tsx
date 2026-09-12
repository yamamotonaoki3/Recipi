/**
 * レシピカード（screens/components.md §レシピカード）。
 *
 * Issue #38 の「自分のレシピ一覧」で使う版。サムネイルが無いレシピは
 * プレースホルダ。投稿者はアバターと表示名を表示する。
 */
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import type { RecipeSummary } from "@/features/recipe/api";

type RecipeCardProps = {
  recipe: RecipeSummary;
  onPress: () => void;
  testID?: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function RecipeCard({ recipe, onPress, testID }: RecipeCardProps) {
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
              アバター未設定なら、Avatar 部品が表示名の頭文字を出す。 */}
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
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-xs text-neutral-400">{formatDate(recipe.createdAt)}</Text>
          {!recipe.isPublic && (
            <Text
              testID={testID ? `${testID}-private-badge` : undefined}
              className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600"
            >
              非公開
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
