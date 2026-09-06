/**
 * スプラッシュ画面用: 「ログインを保持」で保存されたリフレッシュトークンから
 * 自動的にログイン状態を復元する hook。
 *
 * 流れ:
 * 1. セキュアストレージに保存済みのリフレッシュトークンがあるか確認する
 * 2. あれば `POST /auth/refresh` を試す（ネットワーク遅延で長引かないよう
 *    タイムアウトを設ける）
 * 3. 成功: 新しいトークンでログイン状態にする
 *    失敗（無効・タイムアウト・保存なし）: 保存済みトークンを消しておく
 *
 * 成否に関わらず `hydrated` を true にする。これにより
 * `useProtectedRoute`（認可ゲート）が「復元を試す前」と「試した後」を
 * 区別でき、復元前に保護画面へのアクセスを誤ってログインへ弾いてしまう
 * レースを防げる。
 */
import { useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import { secureStorage } from "@/lib/secureStorage";
import { useSession, type SessionUser } from "@/store/session";

const REFRESH_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]);
}

export type AuthRestoreStatus = "restoring" | "restored" | "not-restored";

export function useAuthRefresh(): AuthRestoreStatus {
  const [status, setStatus] = useState<AuthRestoreStatus>("restoring");
  // Strict Mode 等での二重実行を避けるためのガード。
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    async function restore() {
      try {
        const storedRefreshToken = await secureStorage.getRefreshToken();
        if (!storedRefreshToken) {
          setStatus("not-restored");
          return;
        }

        const { data, error } = await withTimeout(
          api.POST("/api/v1/auth/refresh", { body: { refreshToken: storedRefreshToken } }),
          REFRESH_TIMEOUT_MS,
        );
        if (error || !data) throw new Error("refresh failed");

        // `/auth/refresh` はユーザー情報を返さないため、ログイン時に
        // secureStorage へ一緒に保存しておいたものを読み戻す
        // （useLogin.ts 参照）。壊れている・存在しない場合は null のままで
        // よい（表示名なしのホームになるだけで、認証自体は復元できる）。
        const storedUserJson = await secureStorage.getUser();
        let user: SessionUser | null = null;
        if (storedUserJson) {
          try {
            user = JSON.parse(storedUserJson) as SessionUser;
          } catch {
            user = null;
          }
        }

        // useLogin.ts と同じ理由で、セッションを認証済みにする前に
        // ローテーション後のトークンを永続化する。逆順だと、書き込み失敗時に
        // 「復元失敗（not-restored）」と報告しつつメモリ上は認証済み、という
        // 不整合が起きる。
        await secureStorage.setRefreshToken(data.refreshToken);
        useSession.getState().setAuth({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user,
          rememberMe: true,
        });
        setStatus("restored");
      } catch {
        // ストレージ読み取り失敗・refresh失敗・タイムアウトのいずれでも、
        // 保存済みトークンの削除自体が失敗して復元処理全体が止まらないよう、
        // 削除の失敗は握りつぶす（次回起動時に再度無効判定されるだけ）。
        try {
          await secureStorage.deleteRefreshToken();
        } catch {
          // 無視する。
        }
        setStatus("not-restored");
      } finally {
        useSession.getState().setHydrated(true);
      }
    }

    void restore();
  }, []);

  return status;
}
