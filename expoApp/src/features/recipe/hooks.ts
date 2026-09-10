/**
 * レシピまわりの TanStack Query hooks。
 *
 * - サーバーから取ってくるデータ（取得・一覧）は `useQuery` / `useInfiniteQuery`。
 * - 変更操作（作成・編集・削除）は `useMutation`。成功したら関係する
 *   クエリを `invalidateQueries` して、一覧・詳細を最新に張り替える。
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/store/session";

import { FEED_ROOT_KEY } from "@/features/feed/hooks";
import { HISTORY_ROOT_KEY } from "@/features/history/hooks";
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  getUnits,
  listMyRecipes,
  updateRecipe,
  type RecipeWriteRequest,
} from "./api";

export const recipeKeys = {
  detail: (id: string) => ["recipe", id] as const,
  myList: (q: string) => ["my-recipes", q] as const,
  units: ["units"] as const,
};

/**
 * セッションの復元が終わってログイン済みかを返す。
 *
 * 認証必須の API を**復元前に投げない**ためのガード。起動直後は splash が
 * 保存済みトークンで再ログインを試している最中で、その間に投げると 401 →
 * リフレッシュ失敗と見なされ `client.ts` がまだ有効な保存済みトークンを
 * 消してしまう（＝ログインが飛ぶ。Codex #42 レビュー指摘）。
 */
function useAuthReady(): boolean {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);
  return hydrated && isAuthenticated;
}

/** 1 レシピの詳細。 */
export function useRecipe(recipeId: string | undefined) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: recipeKeys.detail(recipeId ?? ""),
    queryFn: () => getRecipe(recipeId as string),
    enabled: Boolean(recipeId) && authReady,
  });
}

/**
 * 自分のレシピ一覧（カーソルページングの無限スクロール）。
 *
 * `useInfiniteQuery` は「ページの配列（pages）」としてデータを持ち、
 * `fetchNextPage()` で次のページを継ぎ足す。`getNextPageParam` が
 * `undefined` を返したら「次は無い」= 末尾に到達。
 */
export function useMyRecipes(q = "") {
  const authReady = useAuthReady();
  return useInfiniteQuery({
    queryKey: recipeKeys.myList(q),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listMyRecipes({ q: q || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: authReady,
  });
}

/** 単位の入力候補。作成/編集画面を開いたときに 1 回取れば十分（リアルタイム同期しない）。 */
export function useUnits() {
  return useQuery({
    queryKey: recipeKeys.units,
    queryFn: getUnits,
    staleTime: 1000 * 60 * 10,
  });
}

export type SaveRecipeInput =
  | { mode: "create"; body: RecipeWriteRequest }
  | { mode: "edit"; recipeId: string; body: RecipeWriteRequest };

/** レシピの作成 / 編集。成功で一覧・詳細クエリを無効化する。 */
export function useSaveRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveRecipeInput) =>
      input.mode === "create" ? createRecipe(input.body) : updateRecipe(input.recipeId, input.body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["my-recipes"] });
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(saved.id) });
      // ホームフィードと閲覧履歴も張り替える。destination ごとにスタックを
      // 分けたのでそれらの画面はマウントされたまま残り、再マウント時の再取得に
      // 頼れない（作ったレシピが「全体」に出ない / 履歴に編集前のタイトルや
      // サムネイルが残る。Codex #42 指摘）。
      void queryClient.invalidateQueries({ queryKey: FEED_ROOT_KEY });
      void queryClient.invalidateQueries({ queryKey: HISTORY_ROOT_KEY });
    },
  });
}

/** レシピの削除。成功で一覧・その詳細クエリを無効化する。 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) => deleteRecipe(recipeId),
    onSuccess: (_data, recipeId) => {
      void queryClient.invalidateQueries({ queryKey: ["my-recipes"] });
      void queryClient.removeQueries({ queryKey: recipeKeys.detail(recipeId) });
      // 削除したレシピがフィード / 履歴に残らないようにする（Codex #42 指摘）。
      void queryClient.invalidateQueries({ queryKey: FEED_ROOT_KEY });
      void queryClient.invalidateQueries({ queryKey: HISTORY_ROOT_KEY });
    },
  });
}
