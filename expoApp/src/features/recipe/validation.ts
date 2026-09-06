/**
 * レシピ作成/編集フォームのクライアント側バリデーション（純粋関数）。
 *
 * サーバー（#37）と同じ制約を、API を呼ぶ前にその場でユーザーへ伝える。
 * 上限値は features/recipe.md §2 の表 ＋ Issue #37 で確定した値
 * （グループ 1〜20 / グループ内材料 1〜50 / 手順 1〜100 / 検索 q は別）。
 */
import type { RecipeFormState, RecipeSubmission } from "./recipeForm";
import type { ServerValidationError } from "./api";

export const LIMITS = {
  TITLE_MAX: 120,
  DESCRIPTION_MAX: 2000,
  SERVINGS_MIN: 1,
  SERVINGS_MAX: 99,
  GROUP_NAME_MAX: 40,
  INGREDIENT_NAME_MAX: 60,
  UNIT_MAX: 20,
  STEP_BODY_MAX: 1000,
  MAX_GROUPS: 20,
  MAX_INGREDIENTS_PER_GROUP: 50,
  MAX_STEPS: 100,
} as const;

/** 行ごと・グループごとのエラーを局所化して持てる形。 */
export type RecipeFormErrors = {
  title?: string;
  description?: string;
  servings?: string;
  /** groupLocalId -> エラー文言 */
  groups: Record<string, string>;
  /** ingredientLocalId -> エラー文言 */
  ingredients: Record<string, string>;
  /** stepLocalId -> エラー文言 */
  steps: Record<string, string>;
  /** フォーム全体のエラー（材料 0 件・手順 0 件など） */
  form?: string;
};

function isBlank(v: string): boolean {
  return v.trim().length === 0;
}

export function hasAnyError(errors: RecipeFormErrors): boolean {
  return Boolean(
    errors.title ||
    errors.description ||
    errors.servings ||
    errors.form ||
    Object.keys(errors.groups).length > 0 ||
    Object.keys(errors.ingredients).length > 0 ||
    Object.keys(errors.steps).length > 0,
  );
}

export function validateRecipeForm(state: RecipeFormState): RecipeFormErrors {
  const errors: RecipeFormErrors = { groups: {}, ingredients: {}, steps: {} };

  // --- タイトル ---
  if (isBlank(state.title)) {
    errors.title = "タイトルを入力してください";
  } else if (state.title.trim().length > LIMITS.TITLE_MAX) {
    errors.title = `タイトルは${LIMITS.TITLE_MAX}文字以内で入力してください`;
  }

  // --- 説明 ---
  if (state.description.length > LIMITS.DESCRIPTION_MAX) {
    errors.description = `説明は${LIMITS.DESCRIPTION_MAX}文字以内で入力してください`;
  }

  // --- 何人分 ---
  const servings = Number(state.servings);
  if (
    state.servings.trim() === "" ||
    !Number.isInteger(servings) ||
    servings < LIMITS.SERVINGS_MIN ||
    servings > LIMITS.SERVINGS_MAX
  ) {
    errors.servings = `何人分は${LIMITS.SERVINGS_MIN}〜${LIMITS.SERVINGS_MAX}の整数で入力してください`;
  }

  // --- 各グループ / 各材料 ---
  // 「完全に空の材料行だけのグループ」は送信時に除外されるので検証対象から外す
  // （空グループが 21 個あっても保存をブロックしない。recipe-editor.md §4）。
  const groupsWithMeaningfulRows = state.groups
    .map((group) => ({
      group,
      meaningfulRows: group.ingredients.filter(
        (i) =>
          !(isBlank(i.name) && isBlank(i.quantity) && isBlank(i.unit) && i.refRecipeId === null),
      ),
    }))
    .filter((g) => g.meaningfulRows.length > 0);

  // --- グループ数（送信されるグループだけを数える） ---
  if (groupsWithMeaningfulRows.length > LIMITS.MAX_GROUPS) {
    errors.form = `材料グループは${LIMITS.MAX_GROUPS}個までです`;
  }

  let totalIngredients = 0;
  for (const { group, meaningfulRows } of groupsWithMeaningfulRows) {
    if (group.name.trim().length > LIMITS.GROUP_NAME_MAX) {
      errors.groups[group.localId] = `グループ名は${LIMITS.GROUP_NAME_MAX}文字以内です`;
    }

    if (meaningfulRows.length > LIMITS.MAX_INGREDIENTS_PER_GROUP) {
      errors.groups[group.localId] =
        `1グループの材料は${LIMITS.MAX_INGREDIENTS_PER_GROUP}件までです`;
    }
    totalIngredients += meaningfulRows.length;

    for (const ing of meaningfulRows) {
      if (isBlank(ing.name)) {
        errors.ingredients[ing.localId] = "材料名を入力してください";
      } else if (ing.name.trim().length > LIMITS.INGREDIENT_NAME_MAX) {
        errors.ingredients[ing.localId] = `材料名は${LIMITS.INGREDIENT_NAME_MAX}文字以内です`;
      } else if (!isBlank(ing.quantity) && !(Number(ing.quantity) > 0)) {
        errors.ingredients[ing.localId] = "数量は0より大きい数値で入力してください";
      } else if (ing.unit.trim().length > LIMITS.UNIT_MAX) {
        errors.ingredients[ing.localId] = `単位は${LIMITS.UNIT_MAX}文字以内です`;
      }
    }
  }

  if (totalIngredients === 0) {
    errors.form = "材料を1つ以上入力してください";
  }

  // --- 手順 ---
  const filledSteps = state.steps.filter((s) => !isBlank(s.body));
  if (filledSteps.length === 0) {
    errors.form = errors.form ?? "手順を1つ以上入力してください";
  }
  if (filledSteps.length > LIMITS.MAX_STEPS) {
    errors.form = `手順は${LIMITS.MAX_STEPS}件までです`;
  }
  for (const step of filledSteps) {
    if (step.body.trim().length > LIMITS.STEP_BODY_MAX) {
      errors.steps[step.localId] = `手順は${LIMITS.STEP_BODY_MAX}文字以内で入力してください`;
    }
  }

  return errors;
}

/**
 * サーバー 400（Pydantic のフィールド別エラー）を、フォーム上の行の下に出せる形へ翻訳する。
 *
 * `loc` は送信 body の構造・配列インデックス（例:
 * `["body", "ingredientGroups", 0, "ingredients", 1, "name"]`）。`submission` の
 * 対応表（buildSubmission が返す localId 配列）でその行を特定する。
 * 対応が取れなかったエラーは `form` に集約する。
 */
export function mapServerErrors(
  serverErrors: ServerValidationError[],
  submission: RecipeSubmission,
): RecipeFormErrors {
  const errors: RecipeFormErrors = { groups: {}, ingredients: {}, steps: {} };
  const unmapped: string[] = [];

  for (const err of serverErrors) {
    // 先頭の "body" を除いたパス。
    const path = err.loc[0] === "body" ? err.loc.slice(1) : err.loc;
    const [head, ...rest] = path;

    if (head === "title" && !errors.title) {
      errors.title = err.msg;
    } else if ((head === "servings" || head === "description") && !errors[head]) {
      errors[head] = err.msg;
    } else if (head === "ingredientGroups" && typeof rest[0] === "number") {
      const groupIdx = rest[0];
      const groupId = submission.groupIds[groupIdx];
      if (rest[1] === "ingredients" && typeof rest[2] === "number") {
        const ingId = submission.ingredientIds[groupIdx]?.[rest[2]];
        if (ingId) errors.ingredients[ingId] = err.msg;
        else unmapped.push(err.msg);
      } else if (groupId) {
        errors.groups[groupId] = err.msg;
      } else {
        unmapped.push(err.msg);
      }
    } else if (head === "steps" && typeof rest[0] === "number") {
      const stepId = submission.stepIds[rest[0]];
      if (stepId) errors.steps[stepId] = err.msg;
      else unmapped.push(err.msg);
    } else {
      unmapped.push(err.msg);
    }
  }

  if (unmapped.length > 0) {
    errors.form = "入力内容を確認してください";
  }
  return errors;
}
