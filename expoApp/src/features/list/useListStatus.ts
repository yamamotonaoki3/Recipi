/**
 * 無限スクロールの一覧の「失敗の種類」を見分ける（Issue #132）。
 *
 * TanStack Query の `useInfiniteQuery` は、次の 2 つのどちらでも、読めた分を残したまま
 * `isError` を立てる。そのため `isError` だけでは、どう直せばよいかが分からない。
 * - 続きのページ（`fetchNextPage`）の読み込みの失敗 → 続きを読み直す
 * - 表示中の一覧の取り直し（`refetch`・投稿や削除のあとの再取得）の失敗 → 取り直す
 *
 * そこで次の 3 つに分ける（lessons #130-1）。
 * - `isInitialError`: まだ 1 件も読めていない失敗。一覧の場所を丸ごとエラー表示にしてよい
 * - `isMoreError`: 続きのページの失敗。一覧は残して、末尾で続きを再試行させる
 * - `isRefreshError`: 取り直しの失敗。一覧は残して、末尾で取り直しを再試行させる
 */

/** 判定に使う、`useInfiniteQuery` の結果の一部（テストで作りやすいよう最小限にする）。 */
export type ListQueryState = {
  data: unknown;
  isError: boolean;
  isFetchNextPageError: boolean;
};

export type ListStatus = {
  isInitialError: boolean;
  isMoreError: boolean;
  isRefreshError: boolean;
  /** 一覧は残っているが、どちらかの失敗が起きている（空状態の文言より優先して出す）。 */
  hasListError: boolean;
};

export function getListStatus(query: ListQueryState): ListStatus {
  const hasData = query.data != null;
  const isInitialError = query.isError && !hasData;
  const isMoreError = hasData && query.isFetchNextPageError;
  const isRefreshError = hasData && query.isError && !query.isFetchNextPageError;
  return {
    isInitialError,
    isMoreError,
    isRefreshError,
    hasListError: isMoreError || isRefreshError,
  };
}

/**
 * 画面の中で使う形。計算するだけで状態は持たないので、hook の名前で呼べる関数にしておく
 * （他の hooks と並べて書いたときに読みやすいよう、`use` で始める）。
 */
export function useListStatus(query: ListQueryState): ListStatus {
  return getListStatus(query);
}
