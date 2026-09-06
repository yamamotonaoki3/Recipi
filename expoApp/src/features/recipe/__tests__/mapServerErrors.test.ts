/**
 * サーバー 400（Pydantic フィールドエラー）→ フォーム行のエラーへの翻訳。
 */
import {
  buildSubmission,
  initialFormState,
  recipeFormReducer,
  type RecipeFormState,
} from "../recipeForm";
import { mapServerErrors } from "../validation";

/** グループ 2 つ・各 1 材料・手順 1 の状態を作る。 */
function twoGroupState(): RecipeFormState {
  let s = initialFormState();
  const g0 = s.groups[0].localId;
  s = recipeFormReducer(s, {
    type: "setIngredientField",
    groupId: g0,
    ingredientId: s.groups[0].ingredients[0].localId,
    field: "name",
    value: "じゃがいも",
  });
  s = recipeFormReducer(s, { type: "addGroup" });
  const g1 = s.groups[1].localId;
  s = recipeFormReducer(s, {
    type: "setIngredientField",
    groupId: g1,
    ingredientId: s.groups[1].ingredients[0].localId,
    field: "name",
    value: "牛肉",
  });
  s = recipeFormReducer(s, { type: "setStepBody", stepId: s.steps[0].localId, value: "切る" });
  return s;
}

describe("mapServerErrors", () => {
  it("title / servings のエラーをフィールドに割り当てる", () => {
    const submission = buildSubmission(twoGroupState());
    const mapped = mapServerErrors(
      [
        { loc: ["body", "title"], msg: "長すぎます", type: "string_too_long" },
        { loc: ["body", "servings"], msg: "範囲外です", type: "value_error" },
      ],
      submission,
    );
    expect(mapped.title).toBe("長すぎます");
    expect(mapped.servings).toBe("範囲外です");
  });

  it("ingredientGroups[i].ingredients[j] のエラーを、その材料行の localId に割り当てる", () => {
    const state = twoGroupState();
    const submission = buildSubmission(state);
    // 2 番目のグループ（index 1）の 1 番目の材料（index 0）
    const targetIngredientId = submission.ingredientIds[1][0];
    const mapped = mapServerErrors(
      [
        {
          loc: ["body", "ingredientGroups", 1, "ingredients", 0, "name"],
          msg: "材料名が不正です",
          type: "value_error",
        },
      ],
      submission,
    );
    expect(mapped.ingredients[targetIngredientId]).toBe("材料名が不正です");
  });

  it("steps[i] のエラーを手順行の localId に割り当てる", () => {
    const submission = buildSubmission(twoGroupState());
    const stepId = submission.stepIds[0];
    const mapped = mapServerErrors(
      [{ loc: ["body", "steps", 0, "body"], msg: "手順が長すぎます", type: "string_too_long" }],
      submission,
    );
    expect(mapped.steps[stepId]).toBe("手順が長すぎます");
  });

  it("対応が取れないエラーは form に集約する", () => {
    const submission = buildSubmission(twoGroupState());
    const mapped = mapServerErrors(
      [{ loc: ["body", "unknownField"], msg: "謎のエラー", type: "value_error" }],
      submission,
    );
    expect(mapped.form).toBe("入力内容を確認してください");
  });
});
