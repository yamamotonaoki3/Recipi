import { api } from "@/api/client";
import { ApiError, type ErrorEnvelope } from "@/features/auth/api";
import type { components } from "@/api/schema";

export type ProofreadItem = components["schemas"]["ProofreadItem"];
export type ProofreadSuggestion = components["schemas"]["ProofreadSuggestion"];
export type ProofreadKind = ProofreadItem["kind"];

function toApiError(error: unknown, status: number): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  return new ApiError(
    envelope?.error?.message ?? "AI校正に失敗しました",
    envelope?.error?.code,
    status,
    envelope?.error?.details ?? null,
  );
}

export async function proofreadRecipe(
  items: ProofreadItem[],
  signal?: AbortSignal,
): Promise<ProofreadSuggestion[]> {
  const { data, error, response } = await api.POST("/api/v1/ai/proofread", {
    body: { items },
    signal,
  });
  if (error || !data) throw toApiError(error, response.status);
  return data.suggestions;
}
