/**
 * レシピまわりの TanStack Query hooks。
 *
 * - サーバーから取ってくるデータ（取得・一覧）は `useQuery` / `useInfiniteQuery`。
 * - 変更操作（作成・編集・削除）は `useMutation`。成功したら関係する
 *   クエリを `invalidateQueries` して、一覧・詳細を最新に張り替える。
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

/** 1 レシピの詳細。 */
export function useRecipe(recipeId: string | undefined) {
  return useQuery({
    queryKey: recipeKeys.detail(recipeId ?? ""),
    queryFn: () => getRecipe(recipeId as string),
    enabled: Boolean(recipeId),
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
  return useInfiniteQuery({
    queryKey: recipeKeys.myList(q),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listMyRecipes({ q: q || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
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
    },
  });
}
