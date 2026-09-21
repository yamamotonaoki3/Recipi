/**
 * アカウント設定の入力チェック（Issue #242）。
 *
 * 質問・答えの文字数はサインアップと**同じ関数**（`features/auth/validation.ts`）で数える。
 * 絵文字などを 1 文字として数える `countChars` を使っているので、ここで `.length` を
 * 使うとサーバーと境界がずれる。
 *
 * 次の 2 つは**画面独自の入力補助**（サーバーの規則ではない）:
 * - 現在のパスワードが空なら送らない。サーバーは現パスワードに最小長を設けていない
 *   （照合に渡すだけなので）。新しいパスワード用の `validatePassword` の最小長は流用しない
 * - 確認用の答えが一致しなければ送らない
 */
import {
  type FieldErrors,
  validateSecurityAnswer,
  validateSecurityQuestion,
} from "@/features/auth/validation";
import { PASSWORD_MAX_LENGTH } from "@/features/auth/constants";
import { countChars } from "@/lib/textLength";

export type SecurityQuestionFormValues = {
  currentPassword: string;
  securityQuestion: string;
  securityAnswer: string;
  securityAnswerConfirm: string;
};

export type SecurityQuestionFieldErrors = FieldErrors<keyof SecurityQuestionFormValues>;

export function validateSecurityQuestionForm(
  values: SecurityQuestionFormValues,
): SecurityQuestionFieldErrors {
  const errors: SecurityQuestionFieldErrors = {};

  if (!values.currentPassword) {
    errors.currentPassword = "現在のパスワードを入力してください";
  } else if (countChars(values.currentPassword) > PASSWORD_MAX_LENGTH) {
    errors.currentPassword = `パスワードは${PASSWORD_MAX_LENGTH}文字以内です`;
  }

  const question = validateSecurityQuestion(values.securityQuestion);
  if (question) errors.securityQuestion = question;

  const answer = validateSecurityAnswer(values.securityAnswer);
  if (answer) errors.securityAnswer = answer;

  if (values.securityAnswerConfirm !== values.securityAnswer) {
    errors.securityAnswerConfirm = "答えが一致しません";
  }

  return errors;
}
