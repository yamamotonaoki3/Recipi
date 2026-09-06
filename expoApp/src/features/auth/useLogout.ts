/**
 * ログアウト用の hook。
 *
 * サーバー側でリフレッシュトークン（チェーン）を失効させたあと、
 * ローカルのセッション状態とセキュアストレージも消す。
 * サーバー呼び出しが失敗しても（オフライン等）ローカルの状態は必ず消す
 * ——「ログアウトできなくなる」より「サーバー側のトークンは残るがローカルは
 * ログアウト済みになる」方が実害が小さいため。
 */
import { useMutation } from "@tanstack/react-query";

import { logout as logoutApi } from "./api";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

export function useLogout() {
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
