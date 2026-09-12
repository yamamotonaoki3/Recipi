/**
 * お気に入りの TanStack Query hooks（Issue #100）。
 *
 * `useToggleFavorite` は**楽観更新**（screens/recipe-detail.md §5）。♡ を押した瞬間に、
 * 画面に出ている「そのレシピ」のハートとお気に入り数を先に書き換え、失敗したら戻す。
 *
 * 書き換える場所（どれも「そのレシピの行だけ」）:
 * - レシピ詳細（`recipeKeys.detail(id)`）
 * - ホームの全タブ（`FEED_ROOT_KEY`）・閲覧履歴（`HISTORY_ROOT_KEY`）・
 *   自分のレシピ一覧（`["my-recipes"]`）・他人のレシピ一覧（`["user-recipes"]`）
 *
 * F2（フォロー）の教訓を引き継ぐ:
 * - 失敗時はキャッシュ全体を控えから書き戻さず、**そのレシピの分だけ**元に戻す
 *   （別のレシピへの操作が同時に進んでいても消さない。lessons #96-2）
 * - 数を動かすかどうかは、**行ごとにお気に入りの状態が実際に変わるかで判断する**（lessons #96-3）
 * - 操作を始めたときのユーザー ID を控え、完了時に違えば何も書かない（lessons #94-5）
 */
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { FEED_ROOT_KEY } from "@/features/feed/hooks";
import { HISTORY_ROOT_KEY } from "@/features/history/hooks";
import { recipeKeys } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

import { favoriteRecipe, unfavoriteRecipe } from "./api";

/** レシピが並ぶ一覧のキャッシュ（無限スクロールのページの配列）のルートキー。 */
const LIST_ROOT_KEYS: QueryKey[] = [
  FEED_ROOT_KEY,
  HISTORY_ROOT_KEY,
  ["my-recipes"],
  ["user-recipes"],
];

/** お気に入りで変わる項目だけを持つ形（詳細・一覧の行に共通）。 */
type Favoritable = { id: string; isFavorited: boolean; favoriteCount: number };
type ListPage = { items: Favoritable[]; nextCursor?: string | null };

/** 一覧の中の「そのレシピの行」の場所と、書き換える前の値。 */
type RowState = {
  queryKey: QueryKey;
  pageIndex: number;
  rowIndex: number;
  isFavorited: boolean;
  favoriteCount: number;
};

/** 一覧のキャッシュから、そのレシピの行を全部探して控える。 */
function findRows(queryClient: QueryClient, recipeId: string): RowState[] {
  return LIST_ROOT_KEYS.flatMap((root) =>
    queryClient
      .getQueriesData<InfiniteData<ListPage>>({ queryKey: root })
      .flatMap(([queryKey, data]) =>
        (data?.pages ?? []).flatMap((page, pageIndex) =>
          (page?.items ?? []).flatMap((row, rowIndex) =>
            row.id === recipeId
              ? [
                  {
                    queryKey,
                    pageIndex,
                    rowIndex,
                    isFavorited: row.isFavorited,
                    favoriteCount: row.favoriteCount,
                  },
                ]
              : [],
          ),
        ),
      ),
  );
}

/** 一覧の 1 行を書き換える（他の行・他のページには触れない）。 */
function updateRow(
  queryClient: QueryClient,
  rowState: RowState,
  recipeId: string,
  next: (row: Favoritable) => Favoritable,
) {
  queryClient.setQueryData<InfiniteData<ListPage>>(rowState.queryKey, (old) => {
    const row = old?.pages[rowState.pageIndex]?.items[rowState.rowIndex];
    // 取り直しなどで場所がずれていたら書き換えない（別のレシピを壊さない）。
    if (!old || !row || row.id !== recipeId) return old;
    return {
      ...old,
      pages: old.pages.map((page, pageIndex) =>
        pageIndex === rowState.pageIndex
          ? {
              ...page,
              items: page.items.map((item, rowIndex) =>
                rowIndex === rowState.rowIndex ? next(item) : item,
              ),
            }
          : page,
      ),
    };
  });
}

type ToggleFavoriteInput = { recipeId: string; favorite: boolean };

type ToggleFavoriteContext = {
  myId: string | undefined;
  /** 書き換える前のレシピ詳細の値（キャッシュに無ければ undefined）。 */
  previousDetail: Pick<Favoritable, "isFavorited" | "favoriteCount"> | undefined;
  rows: RowState[];
};

/**
 * お気に入りの登録 / 解除（楽観更新つき）。`favorite: true` で登録、`false` で解除。
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ToggleFavoriteInput, ToggleFavoriteContext>({
    mutationKey: ["favorite"],
    mutationFn: ({ recipeId, favorite }) =>
      favorite ? favoriteRecipe(recipeId) : unfavoriteRecipe(recipeId),

    onMutate: async ({ recipeId, favorite }) => {
      const myId = useSession.getState().user?.id;
      const detailKey = recipeKeys.detail(recipeId);

      // 取得中のリクエストがあれば止める（古い値の返事で、先に書き換えた表示を
      // 上書きさせないため）。
      await Promise.all(
        [detailKey, ...LIST_ROOT_KEYS].map((queryKey) => queryClient.cancelQueries({ queryKey })),
      );

      const detail = queryClient.getQueryData<Favoritable>(detailKey);
      const rows = findRows(queryClient, recipeId);
      const delta = favorite ? 1 : -1;

      const context: ToggleFavoriteContext = {
        myId,
        previousDetail: detail
          ? { isFavorited: detail.isFavorited, favoriteCount: detail.favoriteCount }
          : undefined,
        rows,
      };

      const apply = (item: Favoritable): Favoritable => ({
        ...item,
        isFavorited: favorite,
        favoriteCount:
          item.isFavorited !== favorite
            ? Math.max(0, item.favoriteCount + delta)
            : item.favoriteCount,
      });

      queryClient.setQueryData<Favoritable>(detailKey, (old) => (old ? apply(old) : old));
      for (const rowState of rows) updateRow(queryClient, rowState, recipeId, apply);
      return context;
    },

    onError: (_error, { recipeId }, context) => {
      if (!context) return;
      // ユーザー情報がまだ無い場合は、操作開始時も現在も undefined なので同じユーザーとして扱う。
      if (useSession.getState().user?.id !== context.myId) return;
      // 失敗したので、そのレシピの分だけ押す前の値に戻す。
      const { previousDetail } = context;
      if (previousDetail) {
        queryClient.setQueryData<Favoritable>(recipeKeys.detail(recipeId), (old) =>
          old ? { ...old, ...previousDetail } : old,
        );
      }
      for (const rowState of context.rows) {
        updateRow(queryClient, rowState, recipeId, (row) => ({
          ...row,
          isFavorited: rowState.isFavorited,
          favoriteCount: rowState.favoriteCount,
        }));
      }
    },

    onSettled: (_data, _error, { recipeId }, context) => {
      if (!context) return;
      // ユーザー情報がまだ無い場合は、操作開始時も現在も undefined なので同じユーザーとして扱う。
      if (useSession.getState().user?.id !== context.myId) return;
      // このレシピ自身のサーバー書き込みは完了しているので、取り直しても古い値に戻らない。
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      // 操作が複数ある間に取り直すと、別の楽観更新を古いサーバー値で戻してしまう。
      // 自分だけが残った最後の操作が終わるときに、まとめて最新値を取り直す。
      if (queryClient.isMutating({ mutationKey: ["favorite"] }) !== 1) return;
      // 最後にサーバーの正しい値で張り替える。「お気に入りレシピ」タブの
      // 顔ぶれと並び（登録日時の新しい順）もここで最新になる。
      for (const queryKey of LIST_ROOT_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
