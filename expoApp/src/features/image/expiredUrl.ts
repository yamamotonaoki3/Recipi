/**
 * 期限切れになった画像 URL から立て直す仕組み（Issue #186）。
 *
 * ## なぜ必要か
 *
 * レシピのサムネ・手順画像・感想画像は、**期限付きの署名付き URL** で配信される
 * （Issue #185。既定 1 時間 = backend の `IMAGE_URL_TTL_SECONDS`）。
 * アバターだけは期限の無い安定 URL なので、この仕組みの対象ではない。
 *
 * 困るのは「画面を開いたまま放置したとき」。TanStack Query は `staleTime` を
 * 過ぎても**自分から取り直さない**ので、レスポンスはキャッシュに残ったまま、
 * その中の URL だけが失効する。結果、**画像だけが表示できなくなり、放置しても
 * 直らない**。
 *
 * ## どう直すか
 *
 * 画像の読み込みが失敗したら、**表示中のクエリを無効化して取り直す**。
 * 新しいレスポンスには新しい署名付き URL が入っているので、画像が復活する。
 *
 * ## 連打しないための 2 段の歯止め
 *
 * 一覧には画像が何枚も並ぶ。期限が切れるときは**全部まとめて失敗する**ので、
 * 素朴に書くと 1 画面で何十回も再取得が走ってしまう。そこで:
 *
 * 1. **クールダウン**（このファイル）: 最後に立て直してから
 *    `IMAGE_RECOVERY_COOLDOWN_MS` の間は、何枚失敗しても 1 回しか走らせない。
 *    モジュール変数で持つので、画面・コンポーネントをまたいで共有される。
 * 2. **URL ごとに 1 回だけ**（`components/RemoteImage.tsx`）: 同じ URL で
 *    失敗し続けても、その URL では二度と起動しない。
 *
 * オフラインのときは何もしない。電波が無いだけで失敗しているので、取り直しても
 * 同じように失敗するだけ（`onlineManager` は Issue #133 で配線済み）。
 */
import { onlineManager, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** 立て直しの最短間隔（ミリ秒）。 */
export const IMAGE_RECOVERY_COOLDOWN_MS = 30_000;

/**
 * 最後に立て直した時刻。モジュール変数なのでアプリ全体で 1 つ。
 *
 * **まだ一度も立て直していない状態は `null`** で表す（`0` にしない）。`0` だと
 * 「1970 年に立て直した」という意味になり、`now` が小さいときに
 * `now - 0 < クールダウン` が成り立って**初回が見送られてしまう**。実機では
 * `Date.now()` が巨大なので表面化しないが、時刻を渡すテストでは露出する。
 */
let lastRecoveryAt: number | null = null;

/**
 * クールダウンを初期状態に戻す（**テスト専用**）。
 *
 * モジュール変数はテストの間ずっと残るので、これが無いと「前のテストで
 * 立て直した」状態が次のテストに漏れて、結果が実行順で変わってしまう。
 */
export function resetImageRecoveryCooldownForTests(): void {
  lastRecoveryAt = null;
}

/**
 * 表示中のクエリを取り直して、新しい署名付き URL を受け取る。
 *
 * @returns 実際に立て直したら true、クールダウン中やオフラインで見送ったら false。
 */
export function recoverExpiredImages(queryClient: QueryClient, now: number = Date.now()): boolean {
  // オフラインなら取り直しても失敗するだけ。つながったときの自動のやり直しに任せる。
  if (!onlineManager.isOnline()) return false;
  if (lastRecoveryAt !== null && now - lastRecoveryAt < IMAGE_RECOVERY_COOLDOWN_MS) return false;

  lastRecoveryAt = now;
  // `type: "active"` = 今どこかの画面で使われているクエリだけ。裏に残っている
  // 古いキャッシュまで取り直すと、見えていない画面のために通信が増える。
  void queryClient.invalidateQueries({ type: "active" });
  return true;
}

/** 画像の読み込み失敗時に呼ぶ関数を返す hook。 */
export function useExpiredImageRecovery(): () => boolean {
  const queryClient = useQueryClient();
  return useCallback(() => recoverExpiredImages(queryClient), [queryClient]);
}
