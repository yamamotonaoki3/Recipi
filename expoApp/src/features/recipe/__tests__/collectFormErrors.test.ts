/**
 * collectFormErrors の WB テスト（Issue #63）。
 *
 * ここで担保したいのは 2 つ。
 * 1. **並び順が画面と一致すること**。`RecipeFormErrors` は Record なので
 *    順番の情報を持たず、フォーム状態と突き合わせないと正しい順に並ばない。
 * 2. **位置の呼び名が正しいこと**。利用者に見せるのは `row-12` のような
 *    内部 ID ではなく「材料 1-2」「手順 3」という画面上の位置。
 */
import { collectFormErrors } from "../collectFormErrors";
import type { RecipeFormState } from "../recipeForm";
import type { RecipeFormErrors } from "../validation";

function state(): RecipeFormState {
  return {
    title: "",
    description: "",
    servings: "2",
    isPublic: false,
    thumbnailKey: null,
    thumbnailUrl: null,
    groups: [
      {
        localId: "g1",
        name: "",
        ingredients: [
          {
            localId: "i11",
            name: "",
            quantity: "",
            unit: "",
            refRecipeId: null,
            refRecipeTitle: null,
          },
          {
            localId: "i12",
            name: "",
            quantity: "",
            unit: "",
            refRecipeId: null,
            refRecipeTitle: null,
          },
        ],
      },
      {
        localId: "g2",
        name: "合わせ調味料A",
        ingredients: [
          {
            localId: "i21",
            name: "",
            quantity: "",
            unit: "",
            refRecipeId: null,
            refRecipeTitle: null,
          },
        ],
      },
    ],
    steps: [
      { localId: "s1", body: "", imageKey: null, imageUrl: null },
      { localId: "s2", body: "", imageKey: null, imageUrl: null },
      { localId: "s3", body: "", imageKey: null, imageUrl: null },
    ],
    lastAddedRowId: null,
  };
}

function emptyErrors(): RecipeFormErrors {
  return { groups: {}, ingredients: {}, steps: {} };
}

describe("collectFormErrors", () => {
  it("エラーが無ければ空配列", () => {
    expect(collectFormErrors(state(), emptyErrors())).toEqual([]);
  });

  it("画面と同じ順（タイトル → 説明 → 何人分 → 全体 → 材料 → 手順）に並べる", () => {
    const errors: RecipeFormErrors = {
      ...emptyErrors(),
      // わざと画面と違う順に組み立てる。
      steps: { s3: "手順が長すぎます" },
      ingredients: { i21: "材料名を入力してください", i12: "数量が不正です" },
      servings: "何人分が不正です",
      title: "タイトルを入力してください",
      form: "材料を1つ以上入力してください",
      description: "説明が長すぎます",
      groups: { g2: "グループ名が長すぎます" },
    };

    expect(collectFormErrors(state(), errors).map((e) => e.location)).toEqual([
      "タイトル",
      "説明",
      "何人分",
      "入力内容",
      "材料 1-2",
      "材料グループ 2（合わせ調味料A）",
      "材料 2-1",
      "手順 3",
    ]);
  });

  it("位置の呼び名は「グループ番号-行番号」「手順の番号」で付ける", () => {
    const errors: RecipeFormErrors = {
      ...emptyErrors(),
      ingredients: { i11: "A", i21: "B" },
      steps: { s2: "C" },
    };

    expect(collectFormErrors(state(), errors)).toEqual([
      { anchorKey: "ingredient:i11", location: "材料 1-1", message: "A" },
      { anchorKey: "ingredient:i21", location: "材料 2-1", message: "B" },
      { anchorKey: "step:s2", location: "手順 2", message: "C" },
    ]);
  });

  it("名前なしグループは番号だけで呼ぶ", () => {
    const errors: RecipeFormErrors = { ...emptyErrors(), groups: { g1: "グループ名が長すぎます" } };
    expect(collectFormErrors(state(), errors)[0]).toEqual({
      anchorKey: "group:g1",
      location: "材料グループ 1",
      message: "グループ名が長すぎます",
    });
  });

  it("状態に存在しない localId のエラーは黙って捨てる（消した行の取りこぼし対策）", () => {
    const errors: RecipeFormErrors = {
      ...emptyErrors(),
      ingredients: { "already-removed": "残骸" },
      steps: { gone: "残骸" },
    };
    expect(collectFormErrors(state(), errors)).toEqual([]);
  });
});
