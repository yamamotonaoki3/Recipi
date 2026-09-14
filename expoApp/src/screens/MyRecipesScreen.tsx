/**
 * 自分のレシピ一覧（screens/my-recipes.md）。
 *
 * `useMyRecipes()`（useInfiniteQuery）でカーソルページングの無限スクロール。
 * 本格的なマイページからの導線は #42。当面は (app)/index.tsx の一時リンクから来る。
 */
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { ListFooterStatus } from "@/components/ListFooterStatus";
import { RecipeCard } from "@/components/RecipeCard";
import { RecipeCardSkeletonList } from "@/components/Skeleton";
import { getListStatus } from "@/features/list/useListStatus";
import { useMyRecipes } from "@/features/recipe/hooks";

export function MyRecipesScreen({ basePath }: { basePath: string }) {
  const router = useRouter();
  const query = useMyRecipes();
  const { data, isPending, refetch, isRefetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
    query;

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  // 失敗の種類（まだ何も読めていない / 続きの失敗 / 取り直しの失敗）。Issue #132。
  // 続きや取り直しの失敗で画面ごとエラーにすると、読めていた一覧と見出しまで消えてしまう。
  const status = getListStatus(query);

  if (isPending) {
    // 初回の読み込み中はスケルトン（my-recipes.md §4）。
    return (
      <View className="flex-1 bg-white">
        <RecipeCardSkeletonList testID="my-recipes-skeleton" />
      </View>
    );
  }

  if (status.isInitialError) {
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
        // 失敗中は空状態の文言を出さない（末尾の再試行を優先する。lessons #130-2）。
        ListEmptyComponent={
          status.hasListError ? null : (
            <Text testID="my-recipes-empty" className="mt-10 text-center text-neutral-500">
              まだレシピを投稿していません
            </Text>
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={<ListFooterStatus query={query} testID="my-recipes" />}
      />
    </View>
  );
}
