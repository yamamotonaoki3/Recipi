import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  changeEmail,
  changeSecurityQuestion,
  type ChangeEmailRequest,
  type ChangeSecurityQuestionRequest,
} from "./api";
import { ApiError } from "@/features/auth/api";
import { saveRememberChoice } from "@/features/auth/rememberChoice";
import { PROFILE_ROOT_KEY } from "@/features/profile/hooks";
import { usesCookieAuth } from "@/lib/authPlatform";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

/**
 * 秘密の質問の変更。成功してもキャッシュは更新しない
 * （秘密の質問はどの画面にも表示していないため、古くなる値が無い）。
 */
export function useChangeSecurityQuestion() {
  return useMutation({
    mutationFn: (body: ChangeSecurityQuestionRequest) => changeSecurityQuestion(body),
  });
}

/**
 * メールアドレス変更の結果が「はっきり失敗」ではない場合（Issue #276）。
 *
 * 成功するとサーバーは**全セッションを失効**させる（#241）ので、応答を受け取れなかった・
 * 受け取っても端末に保存できなかったときは、**サーバー側だけ変更が済んでいる**。
 * 「もう一度お試しください」では何度やっても古いセッションで失敗する。再送は冪等ではないので、
 * 自動では送り直さず、新しいメールアドレスでの再ログインを案内する。
 *
 * - `committed`: サーバーの変更は成功したが、端末への保存に失敗した
 * - `unknown`: 応答が届かず、サーバーで変更されたか分からない
 */
export class EmailChangeUncertainError extends Error {
  constructor(
    public readonly kind: "committed" | "unknown",
    cause?: unknown,
  ) {
    super(
      kind === "committed" ? "email changed but not saved locally" : "email change unconfirmed",
    );
    this.cause = cause;
  }
}

export function useChangeEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ currentPassword, email }: Omit<ChangeEmailRequest, "rememberMe">) => {
      const current = useSession.getState();
      let result: Awaited<ReturnType<typeof changeEmail>>;
      try {
        result = await changeEmail({ currentPassword, email, rememberMe: current.rememberMe });
      } catch (error) {
        // サーバーが応答を返したエラー（403・409 など）は変更されていない。応答が無いものだけ「不明」。
        if (error instanceof ApiError) throw error;
        throw new EmailChangeUncertainError("unknown", error);
      }
      try {
        await persistNewSession(result, current.rememberMe);
      } catch (error) {
        throw new EmailChangeUncertainError("committed", error);
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_ROOT_KEY });
    },
  });
}

/** 新しいトークン対を端末とメモリに反映する。失敗したら例外（呼び出し側が「変更済み」と伝える）。 */
async function persistNewSession(
  result: Awaited<ReturnType<typeof changeEmail>>,
  rememberMe: boolean,
) {
  const refreshToken = result.refreshToken ?? "";
  if (rememberMe) {
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
  saveRememberChoice(rememberMe);
  useSession.getState().setAuth({
    accessToken: result.accessToken,
    refreshToken,
    user: result.user,
    rememberMe,
  });
}
