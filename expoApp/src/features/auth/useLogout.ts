/**
 * ログアウト用の hook。
 *
 * サーバー側でリフレッシュトークン（チェーン）を失効させたあと、
 * ローカルのセッション状態とセキュアストレージも消す。
 * サーバー呼び出しが失敗しても（オフライン等）ローカルの状態は必ず消す
 * ——「ログアウトできなくなる」より「サーバー側のトークンは残るがローカルは
 * ログアウト済みになる」方が実害が小さいため。
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { logout as logoutApi } from "./api";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { refreshToken } = useSession.getState();
      try {
        if (refreshToken) {
          await logoutApi({ refreshToken });
        }
      } finally {
        // メモリ上のセッションは必ず消す。secureStorage の削除は副次的な
        // 後始末なので、片方が失敗してももう片方は試み、かつログアウト
        // そのものを失敗として扱わない（CLAUDE.md「ベストエフォート」）。
        useSession.getState().clear();
        // サーバーから取ってきたデータのキャッシュ（TanStack Query）も捨てる。
        // `QueryClient` はログアウトしても生き続けるため、消さないと
        // 「A がログアウト → すぐ B がログイン」したときに、stale time の
        // 内側では**再取得なしで A のキャッシュが B の画面に出る**
        // （閲覧履歴は本人だけが見られる情報。Codex #42 レビュー指摘）。
        try {
          queryClient.clear();
        } catch {
          // 後始末なので、失敗してもログアウト自体は成功扱いにする。
        }
        try {
          await secureStorage.deleteRefreshToken();
        } catch {
          // 無視する。
        }
        try {
          await secureStorage.deleteUser();
        } catch {
          // 無視する。
        }
      }
    },
  });
}
