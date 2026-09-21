/**
 * `recipeForm.ts` の reducer を React の `useReducer` に載せる薄い hook。
 *
 * 「未保存判定（dirty）」用に、初期状態のスナップショット（baseline）も
 * 一緒に返す。編集モードでは `fromRecipeResponse(recipe)` を初期状態にし、
 * それがそのまま baseline になる。
 */
import { useCallback, useEffect, useMemo, useReducer } from "react";

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

type FormContainer = { state: RecipeFormState; baseline: RecipeFormState };
type ContainerAction =
  Parameters<typeof recipeFormReducer>[1] | { type: "syncRecipe"; state: RecipeFormState };

function formContainerReducer(container: FormContainer, action: ContainerAction): FormContainer {
  if (action.type === "syncRecipe") {
    return { state: action.state, baseline: action.state };
  }
  return { ...container, state: recipeFormReducer(container.state, action) };
}

/** `recipe` を渡すと編集モード（その値が初期値＝baseline）、渡さなければ新規モード。 */
export function useRecipeForm(recipe?: RecipeResponse): UseRecipeFormResult {
  const incoming = useMemo(
    () => (recipe ? fromRecipeResponse(recipe) : initialFormState()),
    [recipe],
  );
  const [container, dispatchInternal] = useReducer(formContainerReducer, {
    state: incoming,
    baseline: incoming,
  });
  const dispatch = useCallback(
    (action: Parameters<typeof recipeFormReducer>[1]) => dispatchInternal(action),
    [],
  );

  // React Query may replace an initially stale recipe with the latest response after
  // the editor has mounted. Synchronize only while the user has not edited the form.
  // Keeping the previous baseline in state means dirty is evaluated against the
  // user's original data even while a newer response is waiting to be applied.
  useEffect(() => {
    if (incoming === container.baseline || isDirty(container.state, container.baseline)) return;

    dispatchInternal({ type: "syncRecipe", state: incoming });
  }, [container, incoming]);

  return {
    state: container.state,
    dispatch,
    baseline: container.baseline,
    dirty: isDirty(container.state, container.baseline),
  };
}
