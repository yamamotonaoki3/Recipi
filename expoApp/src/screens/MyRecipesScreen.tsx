/**
 * 自分のレシピ一覧（screens/my-recipes.md）。
 *
 * `useMyRecipes()`（useInfiniteQuery）でカーソルページングの無限スクロール。
 * 本格的なマイページからの導線は #42。当面は (app)/index.tsx の一時リンクから来る。
 */
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { RecipeCard } from "@/components/RecipeCard";
import { useMyRecipes } from "@/features/recipe/hooks";

export function MyRecipesScreen({ basePath }: { basePath: string }) {
  const router = useRouter();
  const {
    data,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMyRecipes();

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
        <Text className="text-neutral-600">読み込みに失敗しました</Text>
        <Pressable
          testID="my-recipes-retry"
          onPress={() => void refetch()}
          accessibilityRole="button"
          className="rounded-lg border border-neutral-300 px-4 py-2"
        >
          <Text className="text-neutral-700">再試行</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-neutral-200 px-4 py-3">
        <Text className="text-lg font-bold text-neutral-900">自分のレシピ</Text>
      </View>
      <FlatList
        testID="my-recipes-list"
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerClassName="gap-2 p-4"
        renderItem={({ item }) => (
          <RecipeCard
            testID={`my-recipe-${item.id}`}
            recipe={item}
            onPress={() => router.push(`${basePath}/recipes/${item.id}` as never)}
          />
        )}
        ListEmptyComponent={
          <Text className="mt-10 text-center text-neutral-500">まだレシピを投稿していません</Text>
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null}
      />
    </View>
  );
}
