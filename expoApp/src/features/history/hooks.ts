/**
 * 閲覧履歴の TanStack Query hooks（Issue #42）。
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { clearHistory, getHistory, recordRecipeView } from "./api";
import { useSession } from "@/store/session";

/** 無効化の対象を指すルートキー（ユーザーをまたいでまとめて消したいときに使う）。 */
export const HISTORY_ROOT_KEY = ["history"] as const;

/**
 * 送信中の「閲覧を記録」リクエスト。
 *
 * 記録は fire-and-forget（結果を待たない）なので、**消去より後にサーバーへ
 * 届くと、消したはずの履歴が 1 件だけ復活する**（Codex #42 レビュー指摘）。
 * 消去の前にここに溜まった記録の決着を待つことで、消去が必ず最後になる。
 */
const pendingViewRecords = new Set<Promise<unknown>>();

/**
 * 消去の実行中かどうか。
 *
 * 実行中に新しい記録を送ると、待ち合わせのスナップショットに入らないまま
 * 消去の後に届いて履歴が復活する。記録は仕様上「失敗しても履歴に載らない
 * だけ」（view-history.md §3）なので、**消去中は記録そのものを見送る**のが
 * いちばん単純で確実（Codex #42 レビュー指摘）。
 */
let historyClearInProgress = false;

/** 送信中の記録を待つ上限（ms）。 */
const PENDING_RECORD_WAIT_MS = 3000;

export const historyKeys = {
  /**
   * **ユーザー ID をキーに含める**。閲覧履歴は本人しか見られない情報
   * （features/view-history.md §3）だが、`QueryClient` はログアウトしても
   * 生き続けるため、キーが `["history"]` だけだと「A がログアウト →
   * すぐ B がログイン」したときに B の画面へ A のキャッシュが出てしまう
   * （Codex #42 レビュー指摘）。ログアウト時のキャッシュ全消去
   * （`useLogout`）と合わせて二重に防ぐ。
   */
  list: (userId: string) => ["history", userId] as const,
};

/** 最近見たレシピ一覧（カーソルページングの無限スクロール）。 */
export function useHistory() {
  const userId = useSession((s) => s.user?.id);
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);

  return useInfiniteQuery({
    queryKey: historyKeys.list(userId ?? "anonymous"),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      getHistory({ cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    // セッション復元が終わるまで送らない理由は features/feed/hooks.ts と同じ。
    enabled: hydrated && isAuthenticated,
  });
}

/** 履歴の全消去。成功したら一覧を無効化して空状態に張り替える。 */
export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      historyClearInProgress = true;
      try {
        // 送信中の閲覧記録があれば、先に決着させてから消す（上のコメント参照）。
        // 記録が失敗していても構わないので `allSettled` で待つ。
        // ただし**無制限には待たない**: 記録側にタイムアウトが無いため、応答が
        // 返らないと消去が永久に完了せず、利用者が操作を終えられなくなる
        // （Codex #42 レビュー指摘）。待てなかった記録は諦めて消去を優先する
        // （消去は利用者が明示的に確認した操作なので、そちらを勝たせる）。
        if (pendingViewRecords.size > 0) {
          await Promise.race([
            Promise.allSettled([...pendingViewRecords]),
            new Promise((resolve) => setTimeout(resolve, PENDING_RECORD_WAIT_MS)),
          ]);
        }
        await clearHistory();
      } finally {
        historyClearInProgress = false;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_ROOT_KEY });
    },
  });
}

/**
 * 閲覧の記録（fire-and-forget）。
 *
 * **失敗を握りつぶす**のが仕様（view-history.md §3「失敗しても画面には影響しない
 * （履歴に載らないだけ）」）。`onError` を空にしておかないと、TanStack Query が
 * 投げた例外が未処理の Promise 拒否になり、開発時に赤い警告が出る。
 *
 * 成功したら履歴一覧を無効化する。destination ごとにスタックを分けたことで
 * 履歴画面は**タブを離れてもマウントされたまま**になり、再マウント時の
 * 再取得に頼れなくなったため（Codex #42 レビュー指摘）。
 */
export function useRecordView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      // 消去中は記録しない（消したものが復活しないように。上のコメント参照）。
      if (historyClearInProgress) return;

      const request = recordRecipeView(recipeId);
      // 消去がこの記録を追い越さないよう、送信中であることを共有する。
      pendingViewRecords.add(request);
      void request
        .catch(() => {
          // 失敗は握りつぶす（下の onError と同じ理由）。
        })
        .finally(() => pendingViewRecords.delete(request));
      return request;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HISTORY_ROOT_KEY });
    },
    onError: () => {
      // 記録に失敗しても画面には出さない（メイン処理＝詳細表示を壊さない）。
    },
  });
}
