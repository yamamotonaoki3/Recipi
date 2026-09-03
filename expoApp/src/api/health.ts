/**
 * バックエンドのヘルスチェックを取得する hook。
 *
 * TanStack Query の `useQuery` を使うと:
 * - 取得中 / 成功 / 失敗 の状態を自動で管理してくれる
 * - 同じ `queryKey` のデータをキャッシュし、再取得（refetch）も簡単
 *
 * 実際のレシピ一覧などもこの形（`useQuery` ＋ `api.GET(...)`）で書く。
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "./client";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/healthz");
      if (error) {
        throw new Error("ヘルスチェックに失敗しました");
      }
      return data;
    },
  });
}
