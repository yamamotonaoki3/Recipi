/**
 * レシピ詳細（screens/recipe-detail.md）。
 *
 * Issue #38 の範囲: サムネ / タイトル / メタ / 説明 /
 * グループ別材料（名前なしはフラット） / 番号付き手順 / 参照材料リンク /
 * 本人なら編集・削除。♡・フォロー・感想は Phase 5〜7 なのでレイアウトのみ。
 */
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiError } from "@/features/auth/api";
import { formatQuantity, type Placement } from "@/features/recipe/formatQuantity";
import { useDeleteRecipe, useRecipe } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recipeQuery = useRecipe(id);
  const deleteRecipe = useDeleteRecipe();
  const currentUserId = useSession((s) => s.user?.id);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deadRefMessage, setDeadRefMessage] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  if (recipeQuery.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (recipeQuery.isError) {
    const notFound = recipeQuery.error instanceof ApiError && recipeQuery.error.status === 404;
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
        <Text className="text-neutral-600">
          {notFound ? "表示できません" : "読み込みに失敗しました"}
        </Text>
        <Pressable
          testID="recipe-detail-back"
          onPress={() => router.back()}
          accessibilityRole="button"
          className="rounded-lg border border-neutral-300 px-4 py-2"
        >
          <Text className="text-neutral-700">前の画面へ戻る</Text>
        </Pressable>
      </View>
    );
  }

  const recipe = recipeQuery.data;
  const isOwner = currentUserId != null && recipe.author.id === currentUserId;

  return (
    // 画面ルートでステータスバーの inset を確保する
    // （Issue #57 / #58。理由は RecipeEditor.tsx の同じ箇所のコメント参照）。
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* アプリバー */}
      <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3">
        <Pressable testID="recipe-detail-header-back" onPress={() => router.back()}>
          <Text className="text-neutral-500">← 戻る</Text>
        </Pressable>
        {isOwner && (
          <View className="flex-row gap-3">
            <Pressable
              testID="recipe-detail-edit"
              onPress={() => router.push(`/(app)/recipes/${recipe.id}/edit` as never)}
              accessibilityRole="button"
            >
              <Text className="text-orange-600">編集</Text>
            </Pressable>
            <Pressable
              testID="recipe-detail-delete"
              onPress={() => setConfirmDelete(true)}
              accessibilityRole="button"
            >
              <Text className="text-red-600">削除</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView contentContainerClassName="gap-4 p-4">
        {/* サムネイル（無ければプレースホルダ。features/image.md §2）。
            枠は 4:3 = スマホ標準カメラの比率。高さ固定にすると幅の広い画面で
            写真の上下が大きく切れてしまう（作成画面の ImagePickerField と同じ考え方）。 */}
        <View
          className="w-full items-center justify-center overflow-hidden rounded-xl bg-neutral-100"
          style={{ aspectRatio: 4 / 3 }}
        >
          {recipe.thumbnailUrl ? (
            <Image
              testID="recipe-detail-thumbnail"
              source={{ uri: recipe.thumbnailUrl }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <Text testID="recipe-detail-thumbnail-placeholder" className="text-neutral-400">
              No Image
            </Text>
          )}
        </View>

        <Text testID="recipe-detail-title" className="text-2xl font-bold text-neutral-900">
          {recipe.title}
        </Text>

        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-neutral-500">{recipe.author.displayName}</Text>
          {!recipe.isPublic && (
            <Text className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
              非公開
            </Text>
          )}
        </View>

        <Text className="text-sm text-neutral-500">{recipe.servings} 人分</Text>

        {recipe.description !== "" && (
          <Text className="text-base text-neutral-800">{recipe.description}</Text>
        )}

        {/* 材料 */}
        <View className="gap-2">
          <Text className="text-base font-bold text-neutral-900">材料</Text>
          {recipe.ingredientGroups.map((group, gi) => (
            <View key={gi} className="gap-1">
              {group.name != null && group.name !== "" && (
                <Text
                  testID={`detail-group-name-${gi}`}
                  className="text-sm font-semibold text-neutral-700"
                >
                  {group.name}
                </Text>
              )}
              {group.ingredients.map((ing, ii) => {
                // placement はサーバー（serialize_recipe）が材料ごとに解決済みの
                // 値を返す（features/unit.md §3.1）。/units を引き直さない。
                const qty = formatQuantity({
                  quantity: ing.quantity,
                  unit: ing.unit,
                  placement: ing.placement as Placement,
                });
                const isLink = ing.refRecipe != null;
                return (
                  <View
                    key={ii}
                    testID={`detail-ingredient-${gi}-${ii}`}
                    className="flex-row justify-between"
                  >
                    {isLink ? (
                      <Pressable
                        testID={`detail-ingredient-link-${gi}-${ii}`}
                        onPress={() => {
                          if (ing.refRecipe?.id) {
                            router.push(`/(app)/recipes/${ing.refRecipe.id}` as never);
                          } else {
                            setDeadRefMessage(true);
                          }
                        }}
                        accessibilityRole="link"
                      >
                        <Text className="text-base text-orange-600 underline">{ing.name}</Text>
                      </Pressable>
                    ) : (
                      <Text className="text-base text-neutral-800">{ing.name}</Text>
                    )}
                    <Text className="text-base text-neutral-600">{qty}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* 手順 */}
        <View className="gap-3">
          <Text className="text-base font-bold text-neutral-900">手順</Text>
          {recipe.steps.map((step, si) => (
            <View key={si} testID={`detail-step-${si}`} className="flex-row gap-2">
              <Text className="text-sm font-bold text-neutral-500">{si + 1}.</Text>
              <View className="flex-1 gap-2">
                <Text className="text-base text-neutral-800">{step.body}</Text>
                {step.imageUrl && (
                  <Image
                    testID={`detail-step-${si}-image`}
                    source={{ uri: step.imageUrl }}
                    style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 8 }}
                    contentFit="cover"
                  />
                )}
              </View>
            </View>
          ))}
        </View>

        {/* ♡ / フォロー / 感想は Phase 5〜7。ここではプレースホルダのみ。 */}
        <Text className="text-xs text-neutral-300">お気に入り・感想は今後のフェーズで追加</Text>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        testID="recipe-delete-dialog"
        title="レシピを削除しますか？"
        message="このレシピと関連する材料・手順が削除されます。"
        confirmLabel="削除する"
        onConfirm={() => {
          setConfirmDelete(false);
          deleteRecipe.mutate(recipe.id, {
            onSuccess: () => {
              // 詳細を直接開いていて戻り先が無いと、削除後もこの（消えた）
              // レシピの画面に留まってしまう。戻れなければホームへ replace する。
              if (router.canGoBack()) router.back();
              else router.replace("/(app)" as never);
            },
            // 削除に失敗したら詳細画面に留まり、エラーを知らせる（無言で閉じない）。
            onError: () => setDeleteError(true),
          });
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        visible={deleteError}
        testID="recipe-delete-error-dialog"
        title="削除に失敗しました"
        message="通信環境を確認して、もう一度お試しください。"
        confirmLabel="OK"
        destructive={false}
        onConfirm={() => setDeleteError(false)}
        onCancel={() => setDeleteError(false)}
      />

      <ConfirmDialog
        visible={deadRefMessage}
        testID="recipe-dead-ref-dialog"
        title="このレシピは削除されました"
        message="リンク先のレシピは存在しません。"
        confirmLabel="OK"
        destructive={false}
        onConfirm={() => setDeadRefMessage(false)}
        onCancel={() => setDeadRefMessage(false)}
      />
    </View>
  );
}
