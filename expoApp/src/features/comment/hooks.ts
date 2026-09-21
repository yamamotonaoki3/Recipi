/**
 * 感想（コメント）の TanStack Query hooks（Issue #102）。
 *
 * **楽観更新はしない**。投稿は画像のアップロードを挟むうえ、感想の id・日時は
 * サーバーが決めるので、返事を待たずに正しい行を作れない。代わりに**成功した時点で**
 * サーバーが返した感想でキャッシュを直接書き換え（投稿は先頭に追加・編集は置き換え・
 * 削除は取り除く）、すぐ画面に出す。そのあと一覧とレシピ詳細を取り直して、
 * 他の人の書き込みも含めた最新の状態にそろえる。
 *
 * 操作を始めたときのユーザー ID を控え、完了時に違えば何も書かない（lessons #94-5）。
 * 前のユーザーの操作の結果を、次にログインした人の画面へ混ぜないため。
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { recipeKeys } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
  type Comment,
  type CommentList,
  type CommentUpdate,
} from "./api";

export const commentKeys = {
  list: (recipeId: string) => ["comments", recipeId] as const,
};

/** 1 回に読む件数（API の既定と同じ）。 */
const PAGE_SIZE = 20;

type Pages = InfiniteData<CommentList, string | undefined>;
/** 感想数だけを読み書きするための、レシピ詳細の最小の形。 */
type WithCommentCount = { commentCount: number };

/** セッションの復元が終わったか（一覧は認証任意なので、ログイン状態は問わない）。 */
function useSessionReady(): boolean {
  return useSession((s) => s.hydrated);
}

/** あるレシピの感想一覧（新しい順・無限スクロール）。 */
export function useComments(recipeId: string | undefined) {
  const ready = useSessionReady();
  const queryClient = useQueryClient();
  // 削除 mutation が書き込むローカル marker を observer として購読する。
  // getQueryData だけでは、画面が hidden stack に残ったままでも enabled が
  // 更新されず、ログイン切替時に削除済みレシピを再取得してしまう（Issue #269）。
  const deleted = useQuery({
    queryKey: ["deleted-recipe", recipeId ?? ""],
    queryFn: async () => false,
    enabled: false,
  }).data;
  return useInfiniteQuery({
    queryKey: commentKeys.list(recipeId ?? ""),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      // 画面が hidden stack に残ったまま再取得される競合にも備え、削除 marker
      // を queryFn 内でも確認して API リクエスト自体を止める（Issue #269）。
      if (queryClient.getQueryData<boolean>(["deleted-recipe", recipeId]) === true) {
        return { items: [], nextCursor: null };
      }
      return listComments(recipeId as string, { cursor: pageParam, limit: PAGE_SIZE });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: ready && Boolean(recipeId) && deleted !== true,
  });
}

/** 一覧のキャッシュを書き換える（まだ読んでいなければ何もしない）。 */
function updatePages(
  queryClient: QueryClient,
  recipeId: string,
  update: (items: Comment[], pageIndex: number) => Comment[],
) {
  queryClient.setQueryData<Pages>(commentKeys.list(recipeId), (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page, pageIndex) => ({
            ...page,
            items: update(page.items, pageIndex),
          })),
        }
      : old,
  );
}

/** レシピ詳細の感想数を増減する（0 未満にしない）。 */
function shiftCommentCount(queryClient: QueryClient, recipeId: string, delta: number) {
  queryClient.setQueryData<WithCommentCount>(recipeKeys.detail(recipeId), (old) =>
    old ? { ...old, commentCount: Math.max(0, old.commentCount + delta) } : old,
  );
}

/** 最後にサーバーの値へ張り替える（他の人の書き込みも含めて最新にする）。 */
function refresh(queryClient: QueryClient, recipeId: string) {
  void queryClient.invalidateQueries({ queryKey: commentKeys.list(recipeId) });
  void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
}

/** 操作を始めたときのユーザー ID（完了時に比べる）。 */
type Context = { myId: string | undefined };

function sameUser(context: Context | undefined): boolean {
  return context !== undefined && useSession.getState().user?.id === context.myId;
}

/** 感想を投稿する。成功したら一覧の先頭に足し、感想数を +1 する。 */
export function useCreateComment(recipeId: string) {
  const queryClient = useQueryClient();
  return useMutation<Comment, Error, { body: string; imageKey: string | null }, Context>({
    mutationFn: ({ body, imageKey }) => createComment(recipeId, { body, imageKey }),
    onMutate: () => ({ myId: useSession.getState().user?.id }),
    onSuccess: (created, _input, context) => {
      if (!sameUser(context)) return;
      // 新しい順なので、最初のページの先頭に入れる。
      updatePages(queryClient, recipeId, (items, pageIndex) =>
        pageIndex === 0 ? [created, ...items.filter((c) => c.id !== created.id)] : items,
      );
      shiftCommentCount(queryClient, recipeId, 1);
    },
    onSettled: (_data, _error, _input, context) => {
      if (!sameUser(context)) return;
      refresh(queryClient, recipeId);
    },
  });
}

/** 感想を編集する。成功したらその行をサーバーの返した内容に置き換える。 */
export function useUpdateComment(recipeId: string) {
  const queryClient = useQueryClient();
  return useMutation<Comment, Error, { commentId: string; patch: CommentUpdate }, Context>({
    mutationFn: ({ commentId, patch }) => updateComment(commentId, patch),
    onMutate: () => ({ myId: useSession.getState().user?.id }),
    onSuccess: (updated, _input, context) => {
      if (!sameUser(context)) return;
      updatePages(queryClient, recipeId, (items) =>
        items.map((c) => (c.id === updated.id ? updated : c)),
      );
    },
    onSettled: (_data, _error, _input, context) => {
      if (!sameUser(context)) return;
      refresh(queryClient, recipeId);
    },
  });
}

/** 感想を削除する。成功したら一覧から取り除き、感想数を −1 する。 */
export function useDeleteComment(recipeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { commentId: string }, Context>({
    mutationFn: ({ commentId }) => deleteComment(commentId),
    onMutate: () => ({ myId: useSession.getState().user?.id }),
    onSuccess: (_data, { commentId }, context) => {
      if (!sameUser(context)) return;
      // 一覧に実際にあったときだけ数を減らす（二重に減らさない）。
      const existed = (queryClient.getQueryData<Pages>(commentKeys.list(recipeId))?.pages ?? [])
        .flatMap((page) => page.items)
        .some((c) => c.id === commentId);
      updatePages(queryClient, recipeId, (items) => items.filter((c) => c.id !== commentId));
      if (existed) shiftCommentCount(queryClient, recipeId, -1);
    },
    onSettled: (_data, _error, _input, context) => {
      if (!sameUser(context)) return;
      refresh(queryClient, recipeId);
    },
  });
}
