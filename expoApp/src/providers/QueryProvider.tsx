/**
 * アプリ全体を TanStack Query で使えるようにするプロバイダ。
 * ルートレイアウト（app/_layout.tsx）でアプリを包む。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { setupNativeAppFocus } from "@/features/network/appFocus";
import { setupNativeConnectivity } from "@/features/network/connectivity";
import { useSession } from "@/store/session";
import { ApiError } from "@/features/auth/api";

// スマホの通信状態を TanStack Query に伝える（Issue #133）。アプリの起動時に 1 回だけ
// つなげばよいので、描画のたびではなくこのファイルを読み込んだときに呼ぶ。
setupNativeConnectivity();

// 「アプリに戻ってきた」ことを伝える（Issue #186）。これが無いとネイティブでは
// `refetchOnWindowFocus` が働かず、期限切れの画像 URL が復帰しても直らない。
setupNativeAppFocus();

const MAX_SERVICE_UNAVAILABLE_RETRIES = 2;
const SERVICE_UNAVAILABLE_RETRY_DELAY_MS = 1_000;

/** 過負荷(503)だけを有限回リトライし、再試行嵐を防ぐ。 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 503 &&
    failureCount < MAX_SERVICE_UNAVAILABLE_RETRIES
  );
}

export function retryDelayQuery(attemptIndex: number): number {
  return SERVICE_UNAVAILABLE_RETRY_DELAY_MS * 2 ** attemptIndex;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // QueryClient は「キャッシュの本体」。再レンダーで作り直さないよう useState で 1 度だけ生成。
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: shouldRetryQuery,
            retryDelay: retryDelayQuery,
            staleTime: 30_000, // 30 秒間は再取得しない
          },
        },
      }),
  );

  /**
   * ログイン状態が外れたら、サーバーから取ってきたデータのキャッシュを全部捨てる。
   *
   * `QueryClient` はログアウトしても生き続けるので、消さないと「A が抜けた直後に
   * B がログイン」したときに、stale time の内側では**再取得なしで A のデータが
   * B の画面に出る**（閲覧履歴・自分のレシピなど本人限定の情報が含まれる）。
   *
   * ここ（ストアの購読）で行うのが要点で、セッションが切れる経路は
   * 「ログアウトボタン」だけではない: アクセストークンの失効・`token_version`
   * 不一致・アカウント削除では `api/client.ts` の `clearSessionAndStorage()` が
   * 直接呼ばれ、`useLogout` を通らない（Codex #42 レビュー指摘）。
   * 状態の変化そのものを見ることで、経路を数えなくてもよくなる。
   *
   * 見るのは「ログイン中かどうか」だけでなく**ユーザーが変わったかどうか**も。
   * ログイン済みのままログイン画面へ戻って別アカウントで入り直すと
   * `isAuthenticated` は true のままなので、true→false だけを見ていると
   * 前のユーザーのキャッシュが残る（同・レビュー指摘）。
   */
  useEffect(() => {
    let previous = useSession.getState();
    return useSession.subscribe((state) => {
      const signedOut = previous.isAuthenticated && !state.isAuthenticated;
      // ID が「分からない → 分かった」も切替として扱う。保存済みのユーザー情報が
      // 壊れていると `user=null` のままログイン状態が復元されることがあり、
      // 「両方の ID が非 null のときだけ」にすると取りこぼす（Codex #42 指摘）。
      const changedIdentity = previous.user?.id !== state.user?.id;
      if (signedOut || changedIdentity) {
        client.clear();
      }
      previous = state;
    });
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
