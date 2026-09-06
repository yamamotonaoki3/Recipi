/**
 * サインアップ用の hook。
 *
 * 成功すると（screens/signup.md の仕様どおり）そのままログイン状態になる。
 * ただしサインアップ画面には「ログインを保持」のチェックが無いため、
 * リフレッシュトークンをセキュアストレージへは永続化しない
 * （アプリを再起動したら再ログインが必要になる。rememberMe=false 相当）。
 */
import { useMutation } from "@tanstack/react-query";

import { signup as signupApi } from "./api";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

export type SignupInput = {
  email: string;
  password: string;
  displayName: string;
  securityQuestion: string;
  securityAnswer: string;
};

export function useSignup() {
  return useMutation({
    mutationFn: async (input: SignupInput) => {
      const result = await signupApi(input);
      // useLogin.ts の rememberMe=false 分岐と同じ理由: 端末に別アカウントの
      // 「ログインを保持」情報が残っていると、今回の signup（常に
      // rememberMe=false 相当）にも関わらず次回起動時に古いアカウントで
      // 自動ログインしてしまうため、明示的に消しておく。副次的な後始末なので
      // 削除の失敗で signup 自体の成功を握りつぶさない（CLAUDE.md）。
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
      useSession.getState().setAuth({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        rememberMe: false,
      });
      return result;
    },
  });
}
