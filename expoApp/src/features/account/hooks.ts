import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  changeEmail,
  changeSecurityQuestion,
  type ChangeEmailRequest,
  type ChangeSecurityQuestionRequest,
} from "./api";
import { PROFILE_ROOT_KEY } from "@/features/profile/hooks";
import { usesCookieAuth } from "@/lib/authPlatform";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";
import { saveRememberChoice } from "@/features/auth/rememberChoice";

/**
 * 秘密の質問の変更。成功してもキャッシュは更新しない
 * （秘密の質問はどの画面にも表示していないため、古くなる値が無い）。
 */
export function useChangeSecurityQuestion() {
  return useMutation({
    mutationFn: (body: ChangeSecurityQuestionRequest) => changeSecurityQuestion(body),
  });
}

export function useChangeEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ currentPassword, email }: Omit<ChangeEmailRequest, "rememberMe">) => {
      const current = useSession.getState();
      const result = await changeEmail({ currentPassword, email, rememberMe: current.rememberMe });
      const refreshToken = result.refreshToken ?? "";
      if (current.rememberMe) {
        if (!usesCookieAuth() && !refreshToken) throw new Error("refresh token was not returned");
        if (!usesCookieAuth()) await secureStorage.setRefreshToken(refreshToken);
        try {
          await secureStorage.setUser(JSON.stringify(result.user));
        } catch (error) {
          await secureStorage.deleteRefreshToken();
          throw error;
        }
      } else {
        try {
          await secureStorage.deleteRefreshToken();
        } catch {
          // 副次的な後始末は変更結果を覆さない。
        }
        try {
          await secureStorage.deleteUser();
        } catch {
          // 副次的な後始末は変更結果を覆さない。
        }
      }
      saveRememberChoice(current.rememberMe);
      useSession.getState().setAuth({
        accessToken: result.accessToken,
        refreshToken,
        user: result.user,
        rememberMe: current.rememberMe,
      });
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_ROOT_KEY });
    },
  });
}
