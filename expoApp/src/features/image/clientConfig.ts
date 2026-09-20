/** 画像選択に必要な公開サーバー設定（Issue #230）。 */
import type { QueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";

import { DEFAULT_IMAGE_MAX_DIMENSION } from "./pickImage";

export const CLIENT_CONFIG_QUERY_KEY = ["client-config"] as const;
export const CLIENT_CONFIG_STALE_TIME_MS = 5 * 60 * 1000;

type ClientConfig = { imageMaxDimension: number };

async function fetchClientConfig(): Promise<ClientConfig> {
  const { data, error } = await api.GET("/api/v1/client-config");
  if (error || !data || !Number.isInteger(data.imageMaxDimension) || data.imageMaxDimension < 1) {
    throw new Error("公開設定を取得できませんでした");
  }
  return data;
}

/**
 * 画像選択時に上限を得る。QueryClient が5分間キャッシュするため、同じ利用中に
 * 画像を複数選んでも設定APIを繰り返し呼ばない。通信障害時は既定値で継続する。
 */
export async function getImageMaxDimension(queryClient: QueryClient): Promise<number> {
  try {
    const config = await queryClient.fetchQuery({
      queryKey: CLIENT_CONFIG_QUERY_KEY,
      queryFn: fetchClientConfig,
      staleTime: CLIENT_CONFIG_STALE_TIME_MS,
      retry: false,
    });
    return config.imageMaxDimension;
  } catch {
    return DEFAULT_IMAGE_MAX_DIMENSION;
  }
}
