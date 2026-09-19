/**
 * 認証まわりの API 呼び出し関数。
 *
 * `useLogin` 等の hook から呼ばれる薄いラッパー。openapi-fetch の
 * `error`/`data` の分岐をここでまとめ、hook 側は「成功したデータ」か
 * 「投げられたエラー」のどちらかだけを見ればよいようにする。
 */
import { api } from "@/api/client";
import type { components } from "@/api/schema";

export type AuthTokenResponse = components["schemas"]["AuthTokenResponse"];
export type CurrentUserResponse = components["schemas"]["CurrentUserResponse"];
export type RefreshResponse = components["schemas"]["RefreshResponse"];
export type UserMeResponse = components["schemas"]["UserMeResponse"];
export type PasswordResetRequestResponse = components["schemas"]["PasswordResetRequestResponse"];
export type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

/** API から返ってきたエラーを、画面が表示しやすい形にまとめた例外。 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly status: number,
    // 統一エラー形式（api.md）の `error.details`。バリデーションエラー時は
    // `{ errors: [...] }` が入り、レシピ作成/編集画面がフィールド別の
    // エラー表示に使う（features/recipe/api.ts の extractValidationErrors）。
    public readonly details: Record<string, unknown> | null = null,
    // 503 の Retry-After ヘッダーを API ラッパーがミリ秒へ変換して渡す。
    public readonly retryAfterMs: number | undefined = undefined,
  ) {
    super(message);
  }
}

/** `Retry-After` の秒数形式だけを、Query の待機時間に使うミリ秒へ変換する。 */
export function retryAfterMsFromResponse(response: Pick<Response, "headers">): number | undefined {
  const value = response.headers?.get("Retry-After")?.trim();
  if (value === undefined || !/^\d+$/.test(value)) return undefined;

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds * 1_000 : undefined;
}

export function apiErrorFromResponse(
  error: unknown,
  response: Pick<Response, "status" | "headers">,
  fallback = "通信エラーが発生しました",
): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? fallback;
  const code = envelope?.error?.code;
  return new ApiError(
    message,
    code,
    response.status,
    envelope?.error?.details ?? null,
    retryAfterMsFromResponse(response),
  );
}

export async function signup(body: {
  email: string;
  password: string;
  displayName: string;
  securityQuestion: string;
  securityAnswer: string;
}): Promise<AuthTokenResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/signup", { body });
  if (error || !data) throw apiErrorFromResponse(error, response);
  return data;
}

export async function login(body: {
  email: string;
  password: string;
  rememberMe: boolean;
}): Promise<AuthTokenResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/login", { body });
  if (error || !data) throw apiErrorFromResponse(error, response);
  return data;
}

/** 退会済みアカウントを、入力済みの認証情報で明示的に再開する。 */
export async function reactivate(body: {
  email: string;
  password: string;
  rememberMe: boolean;
}): Promise<AuthTokenResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/reactivate", { body });
  if (error || !data) throw apiErrorFromResponse(error, response);
  return data;
}

/** CookieでrefreshしたWebクライアントが、現在ユーザーを復元するために使う。 */
export async function getCurrentUser(accessToken: string): Promise<CurrentUserResponse> {
  const { data, error, response } = await api.GET("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error || !data) throw apiErrorFromResponse(error, response);
  return data;
}

export async function logout(body: { refreshToken?: string } = {}): Promise<void> {
  const { error, response } = await api.POST("/api/v1/auth/logout", { body });
  if (error) throw apiErrorFromResponse(error, response);
}

export async function requestPasswordReset(body: {
  email: string;
}): Promise<PasswordResetRequestResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/password-reset/request", {
    body,
  });
  if (error || !data) throw apiErrorFromResponse(error, response);
  return data;
}

export async function confirmPasswordReset(body: {
  email: string;
  securityAnswer: string;
  newPassword: string;
}): Promise<void> {
  const { error, response } = await api.POST("/api/v1/auth/password-reset/confirm", { body });
  if (error) throw apiErrorFromResponse(error, response);
}
