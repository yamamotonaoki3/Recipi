/**
 * アプリ全体を TanStack Query で使えるようにするプロバイダ。
 * ルートレイアウト（app/_layout.tsx）でアプリを包む。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useSession } from "@/store/session";

export function QueryProvider({ children }: { children: ReactNode }) {
  // QueryClient は「キャッシュの本体」。再レンダーで作り直さないよう useState で 1 度だけ生成。
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1, // 失敗時に 1 回だけ再試行
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
