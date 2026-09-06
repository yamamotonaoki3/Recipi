/**
 * recipeForm reducer と純粋ヘルパーの WB テスト（Issue #38 テスト要件）。
 */
import type { RecipeResponse } from "../api";
import {
  fromRecipeResponse,
  initialFormState,
  isDirty,
  recipeFormReducer,
  toWriteRequest,
  type RecipeFormAction,
  type RecipeFormState,
} from "../recipeForm";

function reduce(state: RecipeFormState, actions: RecipeFormAction[]): RecipeFormState {
  return actions.reduce(recipeFormReducer, state);
}

describe("initialFormState", () => {
  it("名前なしグループ 1 つ ＋ 空材料行 1 つ ＋ 空手順行 1 つ", () => {
    const s = initialFormState();
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].name).toBe("");
    expect(s.groups[0].ingredients).toHaveLength(1);
    expect(s.steps).toHaveLength(1);
  });
});

describe("行の追加・削除・並べ替え", () => {
  it("材料を追加すると lastAddedRowId がその行になる", () => {
    const s0 = initialFormState();
    const groupId = s0.groups[0].localId;
    const s1 = recipeFormReducer(s0, { type: "addIngredient", groupId });
    expect(s1.groups[0].ingredients).toHaveLength(2);
    expect(s1.lastAddedRowId).toBe(s1.groups[0].ingredients[1].localId);
  });

  it("グループ内最後の 1 材料は removeIngredient で消えない", () => {
    const s0 = initialFormState();
    const groupId = s0.groups[0].localId;
    const ingId = s0.groups[0].ingredients[0].localId;
    const s1 = recipeFormReducer(s0, { type: "removeIngredient", groupId, ingredientId: ingId });
    expect(s1.groups[0].ingredients).toHaveLength(1);
  });

  it("手順の並べ替え（↑↓）で順序が入れ替わる", () => {
    let s = initialFormState();
    s = reduce(s, [{ type: "addStep" }, { type: "addStep" }]);
    s = reduce(s, [
      { type: "setStepBody", stepId: s.steps[0].localId, value: "A" },
      { type: "setStepBody", stepId: s.steps[1].localId, value: "B" },
      { type: "setStepBody", stepId: s.steps[2].localId, value: "C" },
    ]);
    const moved = recipeFormReducer(s, {
      type: "moveStep",
      stepId: s.steps[2].localId,
      direction: "up",
    });
    expect(moved.steps.map((st) => st.body)).toEqual(["A", "C", "B"]);
  });

  it("端の行を範囲外へ動かしても何も起きない", () => {
    const s = initialFormState();
    const moved = recipeFormReducer(s, {
      type: "moveStep",
      stepId: s.steps[0].localId,
      direction: "up",
    });
    expect(moved.steps).toEqual(s.steps);
  });
});

describe("グループ間の材料移動", () => {
  it("材料を別グループの末尾へ移す", () => {
    let s = initialFormState();
    s = recipeFormReducer(s, { type: "addGroup" });
    const g0 = s.groups[0].localId;
    const g1 = s.groups[1].localId;
    // g0 に材料を 1 つ足して 2 件にしてから移動（最後の 1 件は移動不可のため）
    s = recipeFormReducer(s, { type: "addIngredient", groupId: g0 });
    const movingId = s.groups[0].ingredients[1].localId;
    s = recipeFormReducer(s, {
      type: "moveIngredientToGroup",
      ingredientId: movingId,
      toGroupId: g1,
    });
    expect(s.groups[0].ingredients).toHaveLength(1);
    expect(s.groups[1].ingredients.at(-1)?.localId).toBe(movingId);
  });

  it("グループ内最後の 1 材料は移動できない（空グループを作らない）", () => {
    let s = initialFormState();
    s = recipeFormReducer(s, { type: "addGroup" });
    const only = s.groups[0].ingredients[0].localId;
    const next = recipeFormReducer(s, {
      type: "moveIngredientToGroup",
      ingredientId: only,
      toGroupId: s.groups[1].localId,
    });
    expect(next).toBe(s);
  });
});

describe("材料のレシピ参照", () => {
  it("linkRefRecipe: name が空なら参照先タイトルを 60 字で自動入力", () => {
    const s0 = initialFormState();
    const ingId = s0.groups[0].ingredients[0].localId;
    const s1 = recipeFormReducer(s0, {
      type: "linkRefRecipe",
      ingredientId: ingId,
      recipeId: "r1",
      title: "あ".repeat(80),
    });
    const ing = s1.groups[0].ingredients[0];
    expect(ing.refRecipeId).toBe("r1");
    expect(ing.name).toBe("あ".repeat(60));
  });

  it("linkRefRecipe: name 入力済みなら name を上書きしない", () => {
    let s = initialFormState();
    const ingId = s.groups[0].ingredients[0].localId;
    s = recipeFormReducer(s, {
      type: "setIngredientField",
      groupId: s.groups[0].localId,
      ingredientId: ingId,
      field: "name",
      value: "自家製だれ",
    });
    s = recipeFormReducer(s, {
      type: "linkRefRecipe",
      ingredientId: ingId,
      recipeId: "r1",
      title: "元のタイトル",
    });
    expect(s.groups[0].ingredients[0].name).toBe("自家製だれ");
  });

  it("unlinkRefRecipe: リンクは外れるが name は残る", () => {
    let s = initialFormState();
    const ingId = s.groups[0].ingredients[0].localId;
    s = recipeFormReducer(s, {
      type: "linkRefRecipe",
      ingredientId: ingId,
      recipeId: "r1",
      title: "たれ",
    });
    s = recipeFormReducer(s, { type: "unlinkRefRecipe", ingredientId: ingId });
    expect(s.groups[0].ingredients[0].refRecipeId).toBeNull();
    expect(s.groups[0].ingredients[0].name).toBe("たれ");
  });
});

describe("toWriteRequest", () => {
  it("空の手順行・完全に空の材料行・材料 0 のグループを除外し position を送らない", () => {
    let s = initialFormState();
    // グループ0: 有効な材料 1 つ
    s = recipeFormReducer(s, {
      type: "setIngredientField",
      groupId: s.groups[0].localId,
      ingredientId: s.groups[0].ingredients[0].localId,
      field: "name",
      value: "じゃがいも",
    });
    // グループ1: 空のまま（除外されるはず）
    s = recipeFormReducer(s, { type: "addGroup" });
    // 手順: 1つ入力、1つ空
    s = recipeFormReducer(s, {
      type: "setStepBody",
      stepId: s.steps[0].localId,
      value: "切る",
    });
    s = recipeFormReducer(s, { type: "addStep" });
    s = recipeFormReducer(s, { type: "setField", field: "title", value: "  肉じゃが  " });

    const body = toWriteRequest(s);
    expect(body.title).toBe("肉じゃが");
    expect(body.ingredientGroups).toHaveLength(1);
    expect(body.ingredientGroups[0].name).toBeNull();
    expect(body.ingredientGroups[0].ingredients).toEqual([
      { name: "じゃがいも", quantity: null, unit: null, refRecipeId: null },
    ]);
    expect(body.steps).toEqual([{ body: "切る" }]);
    expect(JSON.stringify(body)).not.toContain("position");
  });

  it("数量・単位は trim して、空文字なら null", () => {
    let s = initialFormState();
    const g = s.groups[0].localId;
    const i = s.groups[0].ingredients[0].localId;
    s = reduce(s, [
      { type: "setIngredientField", groupId: g, ingredientId: i, field: "name", value: "砂糖" },
      { type: "setIngredientField", groupId: g, ingredientId: i, field: "quantity", value: " 2 " },
      { type: "setIngredientField", groupId: g, ingredientId: i, field: "unit", value: " 大さじ " },
      { type: "setStepBody", stepId: s.steps[0].localId, value: "混ぜる" },
    ]);
    const body = toWriteRequest(s);
    expect(body.ingredientGroups[0].ingredients[0]).toEqual({
      name: "砂糖",
      quantity: "2",
      unit: "大さじ",
      refRecipeId: null,
    });
  });
});

describe("fromRecipeResponse / hydrate 往復", () => {
  const recipe: RecipeResponse = {
    id: "r1",
    author: { id: "u1", displayName: "太郎" },
    title: "肉じゃが",
    description: "定番",
    servings: 3,
    isPublic: true,
    thumbnailUrl: null,
    thumbnailKey: null,
    isFavorited: false,
    favoriteCount: 0,
    commentCount: 0,
    createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z",
    ingredientGroups: [
      {
        name: null,
        ingredients: [
          {
            name: "じゃがいも",
            quantity: "3.000",
            unit: "個",
            placement: "suffix",
            refRecipe: null,
          },
          {
            name: "自家製だれ",
            quantity: null,
            unit: "大さじ",
            placement: "prefix",
            refRecipe: { id: "r2", title: "自家製だれ" },
          },
        ],
      },
      {
        name: "調味",
        ingredients: [
          { name: "醤油", quantity: null, unit: null, placement: "suffix", refRecipe: null },
        ],
      },
    ],
    steps: [
      { body: "切る", imageUrl: null, imageKey: null },
      { body: "煮る", imageUrl: null, imageKey: null },
    ],
  };

  it("サーバーのレシピをフォーム状態へ流し込める", () => {
    const s = fromRecipeResponse(recipe);
    expect(s.title).toBe("肉じゃが");
    expect(s.servings).toBe("3");
    // NUMERIC(10,3) の "3.000" のような値は入力欄用に "3" へ整える
    expect(s.groups[0].ingredients[0].quantity).toBe("3");
    expect(s.groups[0].ingredients[1].refRecipeId).toBe("r2");
    expect(s.groups[1].name).toBe("調味");
    expect(s.steps.map((st) => st.body)).toEqual(["切る", "煮る"]);
  });

  it("変更しなければ toWriteRequest はサーバーの内容と一致（丸め込みなし）", () => {
    const body = toWriteRequest(fromRecipeResponse(recipe));
    expect(body.ingredientGroups[0].ingredients[0]).toEqual({
      name: "じゃがいも",
      quantity: "3",
      unit: "個",
      refRecipeId: null,
    });
    expect(body.ingredientGroups[0].ingredients[1].refRecipeId).toBe("r2");
  });

  it("手順画像のキーを往復で維持する（編集で既存画像を消さない）", () => {
    const withImage: RecipeResponse = {
      ...recipe,
      steps: [
        { body: "切る", imageUrl: "https://x/img1", imageKey: "uploads/img1" },
        { body: "煮る", imageUrl: null, imageKey: null },
      ],
    };
    const body = toWriteRequest(fromRecipeResponse(withImage));
    expect(body.steps).toEqual([{ body: "切る", imageKey: "uploads/img1" }, { body: "煮る" }]);
  });
});

describe("isDirty", () => {
  it("初期状態との比較は false、フィールドを変えると true", () => {
    const base = initialFormState();
    expect(isDirty(base, base)).toBe(false);
    const changed = recipeFormReducer(base, { type: "setField", field: "title", value: "x" });
    expect(isDirty(changed, base)).toBe(true);
  });

  it("並べ替えだけでも dirty", () => {
    let base = initialFormState();
    base = reduce(base, [{ type: "addStep" }]);
    base = reduce(base, [
      { type: "setStepBody", stepId: base.steps[0].localId, value: "A" },
      { type: "setStepBody", stepId: base.steps[1].localId, value: "B" },
    ]);
    const moved = recipeFormReducer(base, {
      type: "moveStep",
      stepId: base.steps[1].localId,
      direction: "up",
    });
    expect(isDirty(moved, base)).toBe(true);
  });

  it("localId / lastAddedRowId の違いは dirty に数えない", () => {
    const base = initialFormState();
    const touched = recipeFormReducer(base, { type: "clearLastAdded" });
    expect(isDirty(touched, base)).toBe(false);
  });
});
