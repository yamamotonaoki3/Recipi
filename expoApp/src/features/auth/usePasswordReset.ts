/**
 * パスワードリセット用の hook（2ステップ: request → confirm）。
 *
 * screens/password-reset.md の仕様どおり、1画面の中でステップを進める形を
 * 想定しているため、2つの useMutation をまとめて1つの hook として提供する。
 * 「答えだけを検証する中間エンドポイントは無い」ため、confirm 呼び出しは
 * 必ず email + securityAnswer + newPassword を1回で送る。
 */
import { useMutation } from "@tanstack/react-query";

import { confirmPasswordReset, requestPasswordReset } from "./api";

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (input: { email: string }) => requestPasswordReset(input),
  });
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (input: { email: string; securityAnswer: string; newPassword: string }) =>
      confirmPasswordReset(input),
  });
}
