/**
 * `recipeForm.ts` の reducer を React の `useReducer` に載せる薄い hook。
 *
 * 「未保存判定（dirty）」用に、初期状態のスナップショット（baseline）も
 * 一緒に返す。編集モードでは `fromRecipeResponse(recipe)` を初期状態にし、
 * それがそのまま baseline になる。
 */
import { useMemo, useReducer } from "react";

import {
  fromRecipeResponse,
  initialFormState,
  isDirty,
  recipeFormReducer,
  type RecipeFormState,
} from "./recipeForm";
import type { RecipeResponse } from "./api";

export type UseRecipeFormResult = {
  state: RecipeFormState;
  dispatch: React.Dispatch<Parameters<typeof recipeFormReducer>[1]>;
  baseline: RecipeFormState;
  dirty: boolean;
};

/** `recipe` を渡すと編集モード（その値が初期値＝baseline）、渡さなければ新規モード。 */
export function useRecipeForm(recipe?: RecipeResponse): UseRecipeFormResult {
  // 初期状態は初回マウント時に 1 回だけ作る（useReducer の第3引数 = 遅延初期化）。
  const [state, dispatch] = useReducer(recipeFormReducer, recipe, (r) =>
    r ? fromRecipeResponse(r) : initialFormState(),
  );

  // baseline も同じ入力から 1 回だけ作る。以後は変化しない基準点。
  const baseline = useMemo(
    () => (recipe ? fromRecipeResponse(recipe) : initialFormState()),
    [recipe],
  );

  return { state, dispatch, baseline, dirty: isDirty(state, baseline) };
}
