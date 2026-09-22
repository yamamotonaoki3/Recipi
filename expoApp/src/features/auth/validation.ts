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
// 文字数は backend と同じコードポイントで数える（絵文字を 2 と数えない。Issue #134）。
import { countChars } from "@/lib/textLength";

export type FieldErrors<Fields extends string> = Partial<Record<Fields, string>>;

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function validateEmail(email: string): string | undefined {
  if (isBlank(email)) return "メールアドレスを入力してください";
  // クライアントでは入力ミスを早く知らせ、細かな形式判定はサーバーにも残す。
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return "有効なメールアドレスを入力してください";
  }
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (isBlank(password)) return "パスワードを入力してください";
  if (countChars(password) < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`;
  }
  if (countChars(password) > PASSWORD_MAX_LENGTH) {
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
  if (countChars(displayName) > DISPLAY_NAME_MAX_LENGTH) {
    return `表示名は${DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください`;
  }
  return undefined;
}

export function validateSecurityQuestion(question: string): string | undefined {
  if (isBlank(question)) return "秘密の質問を入力してください";
  if (countChars(question) > SECURITY_QUESTION_MAX_LENGTH) {
    return `秘密の質問は${SECURITY_QUESTION_MAX_LENGTH}文字以内で入力してください`;
  }
  return undefined;
}

export function validateSecurityAnswer(answer: string): string | undefined {
  if (isBlank(answer)) return "秘密の質問の答えを入力してください";
  if (countChars(answer) > SECURITY_ANSWER_MAX_LENGTH) {
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

export type LoginFormValues = { email: string; password: string };
export type LoginFieldErrors = FieldErrors<keyof LoginFormValues> & { form?: string };

export function validateLogin(values: LoginFormValues): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const email = validateEmail(values.email);
  if (email) errors.email = email;
  const password = validatePassword(values.password);
  if (password) errors.password = password;
  return errors;
}

export type ServerValidationField = {
  loc?: unknown;
  msg?: unknown;
  type?: unknown;
};

type ServerValidationDetails = Record<string, unknown> | null;

export function localizeServerValidationMessage(field: string, message: unknown): string {
  const original = typeof message === "string" ? message : "";
  const msg = original.toLowerCase();
  if (field === "email" && (msg.includes("email") || msg.includes("valid"))) {
    return "有効なメールアドレスを入力してください";
  }
  if (field === "password" && (msg.includes("character") || msg.includes("length"))) {
    return "パスワードの長さを確認してください";
  }
  if (msg.includes("at most") || msg.includes("less than or equal")) {
    const labels: Record<string, string> = {
      displayName: "表示名",
      securityQuestion: "秘密の質問",
      securityAnswer: "答え",
    };
    if (labels[field]) return `${labels[field]}の文字数を確認してください`;
  }
  if (/[ぁ-んァ-ン一-龥]/.test(original)) return original;
  return "入力内容を確認してください";
}

function serverMessage(field: string, issue: ServerValidationField): string {
  return localizeServerValidationMessage(field, issue.msg);
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** API共通の400 details.errorsを、画面で安全に表示できる形へ変換する。 */
export function mapServerValidationErrors(
  details: ServerValidationDetails,
  fields: readonly string[],
): Record<string, string> {
  const known = new Set(fields);
  const result: Record<string, string> = {};
  const raw = details?.errors;
  if (!Array.isArray(raw)) return { form: "入力内容を確認してください" };

  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const issue = candidate as ServerValidationField;
    if (!Array.isArray(issue.loc)) continue;
    const field = issue.loc
      .map(String)
      .map(toCamelCase)
      .find((part) => known.has(part));
    if (field && !result[field]) result[field] = serverMessage(field, issue);
  }
  if (Object.keys(result).length === 0) result.form = "入力内容を確認してください";
  return result;
}

export function hasFieldErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((v) => v !== undefined);
}
