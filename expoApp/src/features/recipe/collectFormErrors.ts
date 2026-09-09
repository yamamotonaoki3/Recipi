/**
 * バリデーションエラーを「画面に並んでいる順」に整列し、
 * 「どこのエラーか」を人が読める名前で言い直す（Issue #63）。
 *
 * ## なぜこの関数が要るか
 *
 * `RecipeFormErrors`（validation.ts）は、材料と手順のエラーを
 * `Record<localId, メッセージ>` で持っている。連想配列なので **順番の情報が無い**。
 * また `localId`（`row-12` のような内部 ID）は利用者には意味がない。
 *
 * そのまま並べるとエラーの並び順が画面と食い違い、「どれから直せばいいか」が
 * 分からなくなる。そこでフォームの状態（`RecipeFormState`）と突き合わせて
 * 画面と同じ順に並べ直し、`row-12` を「材料 1-2」のような位置の呼び名に変換する。
 *
 * React に依存しない純粋関数にしてあるので、並び順と文言だけを単体テストできる。
 */
import type { RecipeFormState } from "./recipeForm";
import type { RecipeFormErrors } from "./validation";

export type FormErrorEntry = {
  /**
   * スクロール先の目印を引くためのキー。`RecipeEditor` が同じキーで
   * 各欄の View を登録しておき、「最初のエラーへ移動」でここへスクロールする。
   */
  anchorKey: string;
  /** 利用者に「どこのエラーか」を伝える名前。例: 「手順 3」「材料 1-2」。 */
  location: string;
  message: string;
};

/** 材料行の目印キー。`RecipeEditor` 側の登録と必ず同じ関数を使う。 */
export function ingredientAnchorKey(localId: string): string {
  return `ingredient:${localId}`;
}

/** 材料グループの目印キー。 */
export function groupAnchorKey(localId: string): string {
  return `group:${localId}`;
}

/** 手順の目印キー。 */
export function stepAnchorKey(localId: string): string {
  return `step:${localId}`;
}

/**
 * 画面の並び順（タイトル → 説明 → 何人分 → フォーム全体 → 材料 → 手順）で
 * エラーを列挙する。エラーが無ければ空配列。
 */
export function collectFormErrors(
  state: RecipeFormState,
  errors: RecipeFormErrors,
): FormErrorEntry[] {
  const entries: FormErrorEntry[] = [];

  if (errors.title)
    entries.push({ anchorKey: "title", location: "タイトル", message: errors.title });
  if (errors.description) {
    entries.push({ anchorKey: "description", location: "説明", message: errors.description });
  }
  if (errors.servings) {
    entries.push({ anchorKey: "servings", location: "何人分", message: errors.servings });
  }
  // 「材料を1つ以上入力してください」のような、特定の欄に紐づかないエラー。
  // 画面では ScrollView の先頭に出しているので、ここでも先頭寄りに置く。
  if (errors.form) entries.push({ anchorKey: "form", location: "入力内容", message: errors.form });

  state.groups.forEach((group, groupIndex) => {
    const groupNumber = groupIndex + 1;
    const groupError = errors.groups[group.localId];
    if (groupError) {
      // 名前を付けているグループは、番号だけより名前があった方が探しやすい。
      const named = group.name.trim();
      entries.push({
        anchorKey: groupAnchorKey(group.localId),
        location: named ? `材料グループ ${groupNumber}（${named}）` : `材料グループ ${groupNumber}`,
        message: groupError,
      });
    }

    group.ingredients.forEach((ingredient, rowIndex) => {
      const message = errors.ingredients[ingredient.localId];
      if (!message) return;
      entries.push({
        anchorKey: ingredientAnchorKey(ingredient.localId),
        // 「グループ番号 - 行番号」。グループが 1 つでも同じ形にして、
        // 画面上の位置の数え方を一貫させる。
        location: `材料 ${groupNumber}-${rowIndex + 1}`,
        message,
      });
    });
  });

  state.steps.forEach((step, index) => {
    const message = errors.steps[step.localId];
    if (!message) return;
    entries.push({
      anchorKey: stepAnchorKey(step.localId),
      location: `手順 ${index + 1}`,
      message,
    });
  });

  return entries;
}
