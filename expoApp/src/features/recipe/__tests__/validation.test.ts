/**
 * validateRecipeForm の WB テスト（分岐網羅・境界値）。
 */
import { initialFormState, recipeFormReducer, type RecipeFormState } from "../recipeForm";
import { hasAnyError, validateRecipeForm } from "../validation";

/** 「有効な最小レシピ」の状態を作る。 */
function validState(): RecipeFormState {
  let s = initialFormState();
  const g = s.groups[0].localId;
  const i = s.groups[0].ingredients[0].localId;
  s = recipeFormReducer(s, { type: "setField", field: "title", value: "肉じゃが" });
  s = recipeFormReducer(s, {
    type: "setIngredientField",
    groupId: g,
    ingredientId: i,
    field: "name",
    value: "じゃがいも",
  });
  s = recipeFormReducer(s, { type: "setStepBody", stepId: s.steps[0].localId, value: "切る" });
  return s;
}

describe("validateRecipeForm", () => {
  it("有効な最小レシピはエラーなし", () => {
    expect(hasAnyError(validateRecipeForm(validState()))).toBe(false);
  });

  it.each([
    ["空", "", true],
    ["1文字", "あ", false],
    ["120文字", "あ".repeat(120), false],
    ["121文字", "あ".repeat(121), true],
  ])("タイトル: %s", (_label, title, shouldError) => {
    const s = recipeFormReducer(validState(), { type: "setField", field: "title", value: title });
    expect(Boolean(validateRecipeForm(s).title)).toBe(shouldError);
  });

  it.each([
    ["0", "0", true],
    ["1", "1", false],
    ["99", "99", false],
    ["100", "100", true],
    ["空", "", true],
  ])("何人分: %s", (_label, servings, shouldError) => {
    const s = recipeFormReducer(validState(), {
      type: "setField",
      field: "servings",
      value: servings,
    });
    expect(Boolean(validateRecipeForm(s).servings)).toBe(shouldError);
  });

  it("材料名が全部空 → form エラー（材料 0 件）", () => {
    const s = initialFormState();
    const withTitle = recipeFormReducer(s, { type: "setField", field: "title", value: "x" });
    const withStep = recipeFormReducer(withTitle, {
      type: "setStepBody",
      stepId: withTitle.steps[0].localId,
      value: "混ぜる",
    });
    expect(validateRecipeForm(withStep).form).toBe("材料を1つ以上入力してください");
  });

  it("手順が全部空 → form エラー（手順 0 件）", () => {
    const s = validState();
    const cleared = recipeFormReducer(s, {
      type: "setStepBody",
      stepId: s.steps[0].localId,
      value: "   ",
    });
    expect(validateRecipeForm(cleared).form).toBe("手順を1つ以上入力してください");
  });

  it("一部だけ入力された材料行（数量のみ）は材料名エラーになる", () => {
    let s = validState();
    s = recipeFormReducer(s, { type: "addIngredient", groupId: s.groups[0].localId });
    const partialId = s.groups[0].ingredients[1].localId;
    s = recipeFormReducer(s, {
      type: "setIngredientField",
      groupId: s.groups[0].localId,
      ingredientId: partialId,
      field: "quantity",
      value: "2",
    });
    expect(validateRecipeForm(s).ingredients[partialId]).toBe("材料名を入力してください");
  });

  it("数量が 0 以下は材料行エラー", () => {
    let s = validState();
    const id = s.groups[0].ingredients[0].localId;
    s = recipeFormReducer(s, {
      type: "setIngredientField",
      groupId: s.groups[0].localId,
      ingredientId: id,
      field: "quantity",
      value: "0",
    });
    expect(validateRecipeForm(s).ingredients[id]).toBe("数量は0より大きい数値で入力してください");
  });

  it("完全に空の材料行は無視される（送信時に除外されるため）", () => {
    let s = validState();
    s = recipeFormReducer(s, { type: "addIngredient", groupId: s.groups[0].localId });
    // 追加しただけの空行 → エラーなし
    expect(hasAnyError(validateRecipeForm(s))).toBe(false);
  });

  it("空グループ（材料が全部空）が 21 個あっても保存はブロックされない", () => {
    let s = validState();
    for (let i = 0; i < 25; i += 1) {
      s = recipeFormReducer(s, { type: "addGroup" });
    }
    // 空グループは送信時に除外されるので、グループ数上限の対象外
    expect(validateRecipeForm(s).form).toBeUndefined();
    expect(hasAnyError(validateRecipeForm(s))).toBe(false);
  });

  it("空グループに長い名前が付いていても保存をブロックしない", () => {
    let s = validState();
    s = recipeFormReducer(s, { type: "addGroup" });
    s = recipeFormReducer(s, {
      type: "renameGroup",
      groupId: s.groups[1].localId,
      name: "あ".repeat(50),
    });
    expect(hasAnyError(validateRecipeForm(s))).toBe(false);
  });
});
