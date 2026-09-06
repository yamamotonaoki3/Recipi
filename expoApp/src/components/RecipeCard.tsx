/**
 * レシピカード（screens/components.md §レシピカード）。
 *
 * Issue #38 の「自分のレシピ一覧」で使う版。`GET /users/me/recipes` の
 * `RecipeSummary` は id / title / thumbnailUrl / isPublic / createdAt しか
 * 持たないため、投稿者・お気に入り数は出さない（フィード用のフルカードは
 * Phase 4 / #42 で拡張する）。画像は Phase 3（#40）まで常にプレースホルダ。
 */
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

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
