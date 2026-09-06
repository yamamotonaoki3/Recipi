/**
 * ログイン用の hook。
 *
 * `useMutation`（TanStack Query）は「サーバーの状態を変える操作」を
 * 扱うための hook。成功/失敗/送信中を自動で管理してくれる
 * （`useHealth` の `useQuery` は「取得」用、こちらは「更新」用）。
 *
 * 成功したら、セッションストアの更新（`setAuth`）と、rememberMe が
 * true のときだけリフレッシュトークンをセキュアストレージへ保存する
 * 処理をここで行う。画面（login.tsx）は「呼ぶだけ」でよい。
 */
import { useMutation } from "@tanstack/react-query";

import { login as loginApi } from "./api";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

export type LoginInput = {
  email: string;
  password: string;
  rememberMe: boolean;
};

export function useLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const result = await loginApi(input);
      // セッションを認証済みにする前に永続化を確定させる。逆順だと、
      // rememberMe=true でストレージ書き込みが失敗したときに「メモリ上は
      // ログイン済みなのに画面はエラー表示」という不整合が起きる。
      if (input.rememberMe) {
        // `/auth/refresh` はユーザー情報を返さないため、次回起動時の
        // 自動復元（useAuthRefresh）ですぐ使えるようユーザー情報も
        // トークンと一緒に保存しておく。片方だけ書き込めた状態で
        // ミューテーションを失敗として返すと、「ログイン失敗」の画面表示と
        // 裏腹に次回起動時だけ自動ログインしてしまう不整合が起きるため、
        // 2 回目の書き込みが失敗したら 1 回目の分もロールバックする。
        await secureStorage.setRefreshToken(result.refreshToken);
        try {
          await secureStorage.setUser(JSON.stringify(result.user));
        } catch (error) {
          await secureStorage.deleteRefreshToken();
          throw error;
        }
      } else {
        // 以前 rememberMe=true でログインした際の古いトークン・ユーザー情報が
        // 残っていると、今回 false を選んでも次回起動時に復元されてしまうため
        // 明示的に消す。ただしこれは副次的な後始末であり、今回のログイン自体は
        // 既に成功しているため、削除の失敗でログイン結果を変えてはならない
        // （CLAUDE.md「副次的な後始末はベストエフォートにする」）。
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
      useSession.getState().setAuth({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        rememberMe: input.rememberMe,
      });
      return result;
    },
  });
}
