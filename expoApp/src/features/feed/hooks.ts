/**
 * ホームフィードの TanStack Query hooks（Issue #42・#98）。
 *
 * 一覧はカーソルページングなので `useInfiniteQuery`。
 * 書き方は `features/recipe/hooks.ts` の `useMyRecipes()` と同じ形にそろえる。
 */
import { useInfiniteQuery } from "@tanstack/react-query";

import { listFeed, type FeedKind } from "./api";
import { useSession } from "@/store/session";

/**
 * すべてのフィード（全体 / フォロー / フォロワー）を指すルートキー。
 *
 * レシピの作成 / 編集 / 削除（features/recipe/hooks.ts）や、フォロー / 解除
 * （features/follow/hooks.ts）の後にこのキーで無効化すると、どのタブも
 * 次に表示したときに最新になる（home-feed.md §3「次にタブを表示したときに反映」）。
 */
export const FEED_ROOT_KEY = ["feed"] as const;

export const feedKeys = {
  /**
   * タブ（`feed`）と検索語ごとに別のキャッシュにする。
   * こうすると「タブを行き来する」「検索 → × でクリア」で、前の一覧が
   * 再取得なしで戻る。先頭が `FEED_ROOT_KEY` と同じなので、まとめて無効化できる。
   */
  list: (feed: FeedKind, q: string) => ["feed", feed, q] as const,
};

/**
 * ホームフィード（カーソルページングの無限スクロール）。
 *
 * `useInfiniteQuery` は「ページの配列（pages）」としてデータを持ち、
 * `fetchNextPage()` で次のページを継ぎ足す。`getNextPageParam` が
 * `undefined` を返したら「次は無い」= 末尾に到達。
 *
 * `enabled: false` を渡すと**リクエストを一切送らない**。ホームでは、
 * 隠れているサブタブの一覧に使う（表示中のタブだけが取得する）。
 * hook は条件付きで呼べないので、呼ぶこと自体は続けて送信だけ止める。
 *
 * さらに、**セッションの復元が終わってログイン済みになるまでは送らない**。
 * `/home` を直接開いた起動直後は splash が保存済みトークンで再ログインを
 * 試している最中で、アクセストークンがまだ無い。その状態で認証必須の
 * `GET /recipes` を投げると 401 → リフレッシュ失敗と見なされ、
 * `client.ts` が**まだ有効な保存済みリフレッシュトークンを消してしまう**
 * （＝ログインが飛ぶ）。Codex #42 レビュー指摘。
 */
export function useFeed(feed: FeedKind = "all", q = "", options: { enabled?: boolean } = {}) {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);

  return useInfiniteQuery({
    queryKey: feedKeys.list(feed, q),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listFeed({ feed, q: q || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    enabled: (options.enabled ?? true) && hydrated && isAuthenticated,
  });
}
