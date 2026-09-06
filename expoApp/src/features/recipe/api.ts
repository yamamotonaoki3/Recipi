/**
 * レシピまわりの API 呼び出し関数（Issue #38）。
 *
 * `features/auth/api.ts` と同じ方針: openapi-fetch の `error`/`data` 分岐を
 * ここでまとめ、hook 側は「成功データ」か「投げられた `ApiError`」だけを
 * 見ればよいようにする。`ApiError` は auth 側の実装を再利用する。
 */
import { api } from "@/api/client";
import { ApiError } from "@/features/auth/api";
import type { components } from "@/api/schema";

export type RecipeResponse = components["schemas"]["RecipeResponse"];
export type RecipeListResponse = components["schemas"]["RecipeListResponse"];
export type RecipeSummary = components["schemas"]["RecipeSummary"];
export type RecipeWriteRequest = components["schemas"]["RecipeWriteRequest"];
export type IngredientGroupOutput = components["schemas"]["IngredientGroupOutput"];
export type IngredientOutput = components["schemas"]["IngredientOutput"];
export type StepOutput = components["schemas"]["StepOutput"];
export type UnitsResponse = components["schemas"]["UnitsResponse"];
export type UnitOption = components["schemas"]["UnitOption"];

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

/**
 * サーバーの 400（VALIDATION_ERROR）の `details.errors`（Pydantic の
 * エラー配列）。作成/編集画面で「どのフィールドがなぜ弾かれたか」を
 * 各行の下に出すために使う。形は FastAPI/Pydantic v2 準拠。
 */
export type ServerValidationError = {
  loc: (string | number)[];
  msg: string;
  type: string;
};

export function extractValidationErrors(error: ApiError): ServerValidationError[] {
  const raw = error.details?.errors;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ServerValidationError =>
      typeof e === "object" && e !== null && Array.isArray((e as { loc?: unknown }).loc),
  );
}

function toApiError(error: unknown, status: number): ApiError {
  const envelope = error as Partial<ErrorEnvelope> | undefined;
  const message = envelope?.error?.message ?? "通信エラーが発生しました";
  const code = envelope?.error?.code;
  return new ApiError(message, code, status, envelope?.error?.details ?? null);
}

export async function getRecipe(recipeId: string): Promise<RecipeResponse> {
  const { data, error, response } = await api.GET("/api/v1/recipes/{recipe_id}", {
    params: { path: { recipe_id: recipeId } },
  });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function listMyRecipes(query: {
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<RecipeListResponse> {
  const { data, error, response } = await api.GET("/api/v1/users/me/recipes", {
    params: {
      query: {
        q: query.q || undefined,
        cursor: query.cursor || undefined,
        limit: query.limit,
      },
    },
  });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function createRecipe(body: RecipeWriteRequest): Promise<RecipeResponse> {
  const { data, error, response } = await api.POST("/api/v1/recipes", { body });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function updateRecipe(
  recipeId: string,
  body: RecipeWriteRequest,
): Promise<RecipeResponse> {
  const { data, error, response } = await api.PUT("/api/v1/recipes/{recipe_id}", {
    params: { path: { recipe_id: recipeId } },
    body,
  });
  if (error || !data) throw toApiError(error, response.status);
  return data;
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const { error, response } = await api.DELETE("/api/v1/recipes/{recipe_id}", {
    params: { path: { recipe_id: recipeId } },
  });
  if (error) throw toApiError(error, response.status);
}

export async function getUnits(): Promise<UnitsResponse> {
  // `/units` は成功レスポンス（200）しか定義していない（認証任意・入力なし）。
  // openapi-fetch の型上 `error` は `never` になるので、`data` の有無だけを見る。
  const { data } = await api.GET("/api/v1/units");
  if (!data) throw new ApiError("単位の取得に失敗しました", undefined, 0, null);
  return data;
}
