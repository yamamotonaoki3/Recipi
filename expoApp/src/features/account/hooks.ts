import { useMutation } from "@tanstack/react-query";

import { changeSecurityQuestion, type ChangeSecurityQuestionRequest } from "./api";

/**
 * 秘密の質問の変更。成功してもキャッシュは更新しない
 * （秘密の質問はどの画面にも表示していないため、古くなる値が無い）。
 */
export function useChangeSecurityQuestion() {
  return useMutation({
    mutationFn: (body: ChangeSecurityQuestionRequest) => changeSecurityQuestion(body),
  });
}
