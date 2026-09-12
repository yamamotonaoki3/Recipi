/**
 * 認証画面のクライアント側バリデーション（純粋関数）。
 *
 * React コンポーネントに依存しないので、単体テストしやすい。
 * 「必須入力」「文字数」「パスワード確認欄との一致」など、API を呼ぶ前に
 * その場でユーザーに伝えられるチェックだけをここに書く
 * （サーバー側だけが知っているチェック、例えばメール重複は含まない）。
 */
import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SECURITY_ANSWER_MAX_LENGTH,
  SECURITY_QUESTION_MAX_LENGTH,
} from "./constants";

export type FieldErrors<Fields extends string> = Partial<Record<Fields, string>>;

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function validateEmail(email: string): string | undefined {
  if (isBlank(email)) return "メールアドレスを入力してください";
  // 簡易チェックのみ（厳密な形式検証はサーバー側の EmailStr に任せる）。
  if (!email.includes("@")) return "メールアドレスの形式が正しくありません";
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (isBlank(password)) return "パスワードを入力してください";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください`;
  }
  return undefined;
}

export function validatePasswordMatch(password: string, confirm: string): string | undefined {
  if (isBlank(confirm)) return "確認のため、もう一度入力してください";
  if (password !== confirm) return "パスワードが一致しません";
  return undefined;
}

export function validateDisplayName(displayName: string): string | undefined {
  if (isBlank(displayName)) return "表示名を入力してください";
  if (Array.from(displayName).length > DISPLAY_NAME_MAX_LENGTH) {
    return `表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください`;
  }
  return undefined;
}

export function validateSecurityQuestion(question: string): string | undefined {
  if (isBlank(question)) return "秘密の質問を入力してください";
  if (question.length > SECURITY_QUESTION_MAX_LENGTH) {
    return `秘密の質問は${SECURITY_QUESTION_MAX_LENGTH}文字以内で入力してください`;
  }
  return undefined;
}

export function validateSecurityAnswer(answer: string): string | undefined {
  if (isBlank(answer)) return "秘密の質問の答えを入力してください";
  if (answer.length > SECURITY_ANSWER_MAX_LENGTH) {
    return `答えは${SECURITY_ANSWER_MAX_LENGTH}文字以内で入力してください`;
  }
  return undefined;
}

export type SignupFormValues = {
  email: string;
  password: string;
  passwordConfirm: string;
  displayName: string;
  securityQuestion: string;
  securityAnswer: string;
};

export type SignupFieldErrors = FieldErrors<keyof SignupFormValues>;

/** サインアップフォーム全体を検証する。エラーが1つも無ければ空オブジェクトを返す。 */
export function validateSignup(values: SignupFormValues): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  const email = validateEmail(values.email);
  if (email) errors.email = email;
  const password = validatePassword(values.password);
  if (password) errors.password = password;
  const passwordConfirm = validatePasswordMatch(values.password, values.passwordConfirm);
  if (!password && passwordConfirm) errors.passwordConfirm = passwordConfirm;
  const displayName = validateDisplayName(values.displayName);
  if (displayName) errors.displayName = displayName;
  const securityQuestion = validateSecurityQuestion(values.securityQuestion);
  if (securityQuestion) errors.securityQuestion = securityQuestion;
  const securityAnswer = validateSecurityAnswer(values.securityAnswer);
  if (securityAnswer) errors.securityAnswer = securityAnswer;
  return errors;
}

export type PasswordResetConfirmFormValues = {
  securityAnswer: string;
  newPassword: string;
  newPasswordConfirm: string;
};

export type PasswordResetConfirmFieldErrors = FieldErrors<keyof PasswordResetConfirmFormValues>;

export function validatePasswordResetConfirm(
  values: PasswordResetConfirmFormValues,
): PasswordResetConfirmFieldErrors {
  const errors: PasswordResetConfirmFieldErrors = {};
  const securityAnswer = validateSecurityAnswer(values.securityAnswer);
  if (securityAnswer) errors.securityAnswer = securityAnswer;
  const newPassword = validatePassword(values.newPassword);
  if (newPassword) errors.newPassword = newPassword;
  const newPasswordConfirm = validatePasswordMatch(values.newPassword, values.newPasswordConfirm);
  if (!newPassword && newPasswordConfirm) errors.newPasswordConfirm = newPasswordConfirm;
  return errors;
}

export function hasFieldErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((v) => v !== undefined);
}
