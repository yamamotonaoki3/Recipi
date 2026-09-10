/**
 * ホームフィードの TanStack Query hooks（Issue #42）。
 *
 * 一覧はカーソルページングなので `useInfiniteQuery`。
 * 書き方は `features/recipe/hooks.ts` の `useMyRecipes()` と同じ形にそろえる。
 */
import { useInfiniteQuery } from "@tanstack/react-query";

import { listFeed } from "./api";
import { useSession } from "@/store/session";

/** レシピの作成 / 編集 / 削除の後に無効化する対象を指すルートキー。 */
export const FEED_ROOT_KEY = ["feed"] as const;

export const feedKeys = {
  /**
   * 検索語ごとに別のキャッシュにする。
   * こうすると「検索 → × でクリア」で元のフィードが再取得なしで戻る。
   */
  all: (q: string) => ["feed", "all", q] as const,
};

/**
 * ホーム「全体」フィード（カーソルページングの無限スクロール）。
 *
 * `useInfiniteQuery` は「ページの配列（pages）」としてデータを持ち、
 * `fetchNextPage()` で次のページを継ぎ足す。`getNextPageParam` が
 * `undefined` を返したら「次は無い」= 末尾に到達。
 *
 * `enabled: false` を渡すと**リクエストを一切送らない**。MVP で「準備中」の
 * サブタブ（フォロー / フォロワー / お気に入りレシピ）を選んでいる間に使う。
 * hook は条件付きで呼べないので、呼ぶこと自体は続けて送信だけ止める。
 *
 * さらに、**セッションの復元が終わってログイン済みになるまでは送らない**。
 * `/home` を直接開いた起動直後は splash が保存済みトークンで再ログインを
 * 試している最中で、アクセストークンがまだ無い。その状態で認証必須の
 * `GET /recipes` を投げると 401 → リフレッシュ失敗と見なされ、
 * `client.ts` が**まだ有効な保存済みリフレッシュトークンを消してしまう**
 * （＝ログインが飛ぶ）。Codex #42 レビュー指摘。
 */
export function useFeed(q = "", options: { enabled?: boolean } = {}) {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);

  return useInfiniteQuery({
    queryKey: feedKeys.all(q),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listFeed({ q: q || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: (options.enabled ?? true) && hydrated && isAuthenticated,
  });
}
