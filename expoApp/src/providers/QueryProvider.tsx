/**
 * アプリ全体を TanStack Query で使えるようにするプロバイダ。
 * ルートレイアウト（app/_layout.tsx）でアプリを包む。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

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

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
