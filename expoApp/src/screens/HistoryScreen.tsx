/**
 * 閲覧履歴（screens/history.md）。
 *
 * 最近見た順のレシピ一覧。記録そのものはレシピ詳細側で行い（`POST /recipes/{id}/view`）、
 * ここは一覧と全消去だけを担当する。可視性フィルタ（非公開化された他人のレシピを
 * 除く）はサーバー側で済んでいる（features/view-history.md §3）。
 */
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FeedRecipeCard } from "@/components/FeedRecipeCard";
import { useClearHistory, useHistory } from "@/features/history/hooks";

export function HistoryScreen({ basePath }: { basePath: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const history = useHistory();
  const clearHistory = useClearHistory();

  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState(false);
  // 消去できたことを知らせるスナックバー（history.md §5）。破壊的操作なので
  // 「本当に消えたのか」が分からないまま終わらせない。数秒で自然に消す。
  const [clearedNotice, setClearedNotice] = useState(false);

  useEffect(() => {
    if (!clearedNotice) return;
    const timer = setTimeout(() => setClearedNotice(false), 3000);
    return () => clearTimeout(timer);
  }, [clearedNotice]);

  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* アプリバー: destination のルートなので戻る矢印は置かない。 */}
      <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3">
        <Text className="text-lg font-bold text-neutral-900">閲覧履歴</Text>
        <View className="flex-row items-center gap-4">
          {/* デスクトップは「引っぱって更新」ができないので更新ボタンを置く
              （history.md §7）。モバイルは RefreshControl があるので出さない。 */}
          {Platform.OS === "web" && (
            <Pressable
              testID="history-refresh"
              onPress={() => void history.refetch()}
              disabled={history.isRefetching}
              accessibilityRole="button"
            >
              <Text className="text-orange-600">更新</Text>
            </Pressable>
          )}
          <Pressable
            testID="history-clear"
            onPress={() => setConfirmClear(true)}
            disabled={items.length === 0 || clearHistory.isPending}
            accessibilityRole="button"
          >
            <Text className={items.length === 0 ? "text-neutral-300" : "text-red-600"}>消去</Text>
          </Pressable>
        </View>
      </View>

      {history.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : history.isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-neutral-600">読み込みに失敗しました</Text>
          <Pressable
            testID="history-retry"
            onPress={() => void history.refetch()}
            accessibilityRole="button"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          >
            <Text className="text-neutral-700">再試行</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="history-list"
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerClassName="gap-2 p-4"
          renderItem={({ item }) => (
            <FeedRecipeCard
              testID={`history-recipe-${item.id}`}
              recipe={item}
              onPress={() => router.push(`${basePath}/recipes/${item.id}` as never)}
            />
          )}
          ListEmptyComponent={
            <Text testID="history-empty" className="mt-10 text-center text-neutral-500">
              まだ見たレシピがありません
            </Text>
          }
          refreshControl={
            <RefreshControl
              refreshing={history.isRefetching}
              onRefresh={() => void history.refetch()}
            />
          }
          onEndReached={() => {
            if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            history.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null
          }
        />
      )}

      {clearedNotice && (
        <View
          testID="history-cleared-snackbar"
          className="absolute inset-x-4 bottom-6 rounded-lg bg-neutral-800 px-4 py-3"
        >
          <Text className="text-sm text-white">閲覧履歴を消去しました</Text>
        </View>
      )}

      <ConfirmDialog
        visible={confirmClear}
        testID="history-clear-dialog"
        title="閲覧履歴をすべて消去しますか？"
        message="消去すると元に戻せません。"
        confirmLabel="消去する"
        onConfirm={() => {
          setConfirmClear(false);
          clearHistory.mutate(undefined, {
            onSuccess: () => setClearedNotice(true),
            // 失敗を無言で閉じない（レシピ削除の失敗ダイアログと同じ扱い）。
            onError: () => setClearError(true),
          });
        }}
        onCancel={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        visible={clearError}
        testID="history-clear-error-dialog"
        title="消去に失敗しました"
        message="通信環境を確認して、もう一度お試しください。"
        confirmLabel="OK"
        destructive={false}
        onConfirm={() => setClearError(false)}
        onCancel={() => setClearError(false)}
      />
    </View>
  );
}
