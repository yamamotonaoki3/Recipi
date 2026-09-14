/**
 * 無限スクロールの一覧の末尾に置く部品（`FlatList` の `ListFooterComponent`。Issue #132）。
 *
 * 次のうち 1 つだけを、上から優先して出す。
 * 1. 続きの読み込み中 → スピナー
 * 2. 続きのページの読み込みに失敗 →「続きを読み込めませんでした」＋ 続きを読み直す再試行
 * 3. 表示中の一覧の取り直しに失敗 →「最新の状態を読み込めませんでした」＋ 取り直す再試行
 *
 * 失敗の種類ごとに再試行の中身を変えるのが要点。続きの失敗で取り直しを呼んでも失敗した
 * ページは読み直されず、取り直しの失敗で続きを呼んでも（続きが無ければ）何も起きない
 * （lessons #130-1）。判定は `useListStatus` にまとめてある。
 */
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useListStatus, type ListQueryState } from "@/features/list/useListStatus";

type ListFooterStatusProps = {
  /** `useInfiniteQuery` の結果（必要な項目だけ使う）。 */
  query: ListQueryState & {
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
    refetch: () => unknown;
  };
  /** 再試行ボタンの testID の頭（`{testID}-more-retry` / `{testID}-refresh-retry`）。 */
  testID: string;
};

export function ListFooterStatus({ query, testID }: ListFooterStatusProps) {
  const { isMoreError, isRefreshError } = useListStatus(query);

  if (query.isFetchingNextPage) {
    return <ActivityIndicator testID={`${testID}-loading-more`} className="my-4" />;
  }

  if (isMoreError) {
    return (
      <RetryRow
        message="続きを読み込めませんでした"
        testID={`${testID}-more-retry`}
        onRetry={() => void query.fetchNextPage()}
      />
    );
  }

  if (isRefreshError) {
    return (
      <RetryRow
        message="最新の状態を読み込めませんでした"
        testID={`${testID}-refresh-retry`}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return null;
}

/** メッセージ ＋ 再試行ボタン（感想セクションの表示と同じ見た目にそろえる）。 */
function RetryRow({
  message,
  testID,
  onRetry,
}: {
  message: string;
  testID: string;
  onRetry: () => void;
}) {
  return (
    <View className="my-4 items-center gap-2">
      <Text className="text-sm text-neutral-600">{message}</Text>
      <Pressable
        testID={testID}
        onPress={onRetry}
        accessibilityRole="button"
        className="rounded-lg border border-neutral-300 px-4 py-2"
      >
        <Text className="text-neutral-700">再試行</Text>
      </Pressable>
    </View>
  );
}
