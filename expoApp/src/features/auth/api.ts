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
  ) {
    super(message);
  }
}

function toApiError(error: unknown, status: number): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? "通信エラーが発生しました";
  const code = envelope?.error?.code;
  return new ApiError(message, code, status);
}

export async function signup(body: {
  email: string;
  password: string;
  displayName: string;
  securityQuestion: string;
  securityAnswer: string;
}): Promise<AuthTokenResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/signup", { body });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function login(body: {
  email: string;
  password: string;
  rememberMe: boolean;
}): Promise<AuthTokenResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/login", { body });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function logout(body: { refreshToken: string }): Promise<void> {
  const { error, response } = await api.POST("/api/v1/auth/logout", { body });
  if (error) throw toApiError(error, response.status);
}

export async function requestPasswordReset(body: {
  email: string;
}): Promise<PasswordResetRequestResponse> {
  const { data, error, response } = await api.POST("/api/v1/auth/password-reset/request", {
    body,
  });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function confirmPasswordReset(body: {
  email: string;
  securityAnswer: string;
  newPassword: string;
}): Promise<void> {
  const { error, response } = await api.POST("/api/v1/auth/password-reset/confirm", { body });
  if (error) throw toApiError(error, response.status);
}

export async function updateMe(body: { displayName: string }): Promise<UserMeResponse> {
  const { data, error, response } = await api.PATCH("/api/v1/users/me", { body });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}
