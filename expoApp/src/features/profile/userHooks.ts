/**
 * 他のユーザーのプロフィールとレシピ一覧の hooks（Issue #96）。
 *
 * 自分のプロフィールは `hooks.ts` の `useMyProfile`。キャッシュのキーは同じ
 * `profileKeys.detail(id)` を使うので、フォローの楽観更新（features/follow/hooks.ts）が
 * どちらの画面にもそのまま効く。
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useSession } from "@/store/session";

import { getUser, listUserRecipes } from "./api";
import { profileKeys } from "./hooks";

export const userRecipeKeys = {
  list: (userId: string) => ["user-recipes", userId] as const,
};

/** セッションの復元が終わってログイン済みか（復元前に送らない。lessons #42-15）。 */
function useAuthReady(): boolean {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);
  return hydrated && isAuthenticated;
}

/** あるユーザーのプロフィール。`userId` が無いときは送らない。 */
export function useUserProfile(userId: string | undefined) {
  const ready = useAuthReady();
  return useQuery({
    queryKey: profileKeys.detail(userId ?? ""),
    queryFn: () => getUser(userId as string),
    enabled: ready && Boolean(userId),
  });
}

/** あるユーザーのレシピ一覧（無限スクロール）。`userId` が無いときは送らない。 */
export function useUserRecipes(userId: string | undefined) {
  const ready = useAuthReady();
  return useInfiniteQuery({
    queryKey: userRecipeKeys.list(userId ?? ""),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listUserRecipes(userId as string, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: ready && Boolean(userId),
  });
}
