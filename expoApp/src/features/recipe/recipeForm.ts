/**
 * レシピ作成/編集フォームの状態（reducer）と、その純粋な変換ヘルパー。
 *
 * 画面コンポーネント（RecipeEditor.tsx）から状態ロジックを切り離すことで、
 * 「+ で行追加」「行削除で番号詰め」「グループ間移動」「送信用 body への変換」
 * 「未保存判定（dirty）」を React 抜きで単体テストできるようにする
 * （Issue #38 テスト要件の WB 部分）。
 *
 * 仕様の正: features/recipe.md §2・§3。
 */
import { normalizeQuantityText } from "./formatQuantity";
import type { RecipeResponse, RecipeWriteRequest } from "./api";

// --- フォーム上の 1 行 -------------------------------------------------

/** 行の React key ＋「移動」操作の対象指定に使うクライアント採番 ID。API には送らない。 */
let _localIdSeq = 0;
export function makeLocalId(): string {
  _localIdSeq += 1;
  return `row-${_localIdSeq}`;
}

export type IngredientRow = {
  localId: string;
  name: string;
  /** テキスト入力なので文字列で保持。空文字 = 数量なし。 */
  quantity: string;
  /** 自由入力の単位文字列。空文字 = 単位なし。 */
  unit: string;
  /** 別レシピへのリンク。null = 通常の材料。 */
  refRecipeId: string | null;
  /** リンク時に表示するタイトル（name とは別に保持し、リンク解除で name は残す）。 */
  refRecipeTitle: string | null;
};

export type GroupRow = {
  localId: string;
  /** 空文字 = 名前なしグループ。 */
  name: string;
  ingredients: IngredientRow[];
};

export type StepRow = {
  localId: string;
  body: string;
  /**
   * その手順の画像のオブジェクトキー。編集時は「既存の画像を残す」ために
   * PUT で再送する（recipe.md §5: `imageKey` を省略 / null で送るとその手順は
   * 画像なしになる。`fromRecipeResponse` が `RecipeResponse.steps[].imageKey`
   * から復元し、`buildSubmission` が再送する）。
   */
  imageKey: string | null;
  /**
   * 表示用 URL。既存画像はレシピ取得時の `imageUrl`、新しく選んだ画像は
   * `POST /images` のレスポンスの `url` が入る。`imageKey` と必ずセットで
   * 更新する（URL はサーバー側の設定から作られる派生値で、クライアントでは
   * キーから組み立てられない）。
   */
  imageUrl: string | null;
};

export type RecipeFormState = {
  title: string;
  description: string;
  /** 数値ステッパー。文字列で保持し、送信時に数値へ変換（検証は validation.ts）。 */
  servings: string;
  isPublic: boolean;
  /** サムネイルのオブジェクトキー。null = 画像なし。 */
  thumbnailKey: string | null;
  /** サムネイルの表示用 URL（既存画像のときだけ。StepRow.imageUrl と同じ扱い）。 */
  thumbnailUrl: string | null;
  groups: GroupRow[];
  steps: StepRow[];
  /** 直近に「+」で追加した行の localId。その行の入力欄へフォーカスを移すのに使う。 */
  lastAddedRowId: string | null;
};

// --- 初期状態 -------------------------------------------------------

function emptyIngredient(): IngredientRow {
  return {
    localId: makeLocalId(),
    name: "",
    quantity: "",
    unit: "",
    refRecipeId: null,
    refRecipeTitle: null,
  };
}

/** 新規作成時の初期状態: 名前なしグループ 1 つ ＋ 空の材料行 1 つ（recipe.md §2）。 */
export function initialFormState(): RecipeFormState {
  return {
    title: "",
    description: "",
    servings: "2",
    isPublic: false,
    thumbnailKey: null,
    thumbnailUrl: null,
    groups: [{ localId: makeLocalId(), name: "", ingredients: [emptyIngredient()] }],
    steps: [{ localId: makeLocalId(), body: "", imageKey: null, imageUrl: null }],
    lastAddedRowId: null,
  };
}

/** 編集時: サーバーから取得したレシピをフォーム状態へ流し込む。 */
export function fromRecipeResponse(recipe: RecipeResponse): RecipeFormState {
  return {
    title: recipe.title,
    description: recipe.description,
    servings: String(recipe.servings),
    isPublic: recipe.isPublic,
    // `thumbnailKey` はレシピの所有者にだけ返る（backend の
    // `include_image_keys=is_owner`）。編集画面は所有者しか開けないので必ず入る。
    thumbnailKey: recipe.thumbnailKey ?? null,
    thumbnailUrl: recipe.thumbnailUrl ?? null,
    groups: recipe.ingredientGroups.map((g) => ({
      localId: makeLocalId(),
      name: g.name ?? "",
      ingredients: g.ingredients.map((i) => ({
        localId: makeLocalId(),
        name: i.name,
        // サーバーは NUMERIC(10,3) を "300.000" のような文字列で返す。
        // 入力欄に出す値は "300" に整える（表示プレビューは formatQuantity が別途整形）。
        quantity: i.quantity == null ? "" : normalizeQuantityText(i.quantity),
        unit: i.unit ?? "",
        refRecipeId: i.refRecipe?.id ?? null,
        refRecipeTitle: i.refRecipe?.title ?? null,
      })),
    })),
    steps: recipe.steps.map((s) => ({
      localId: makeLocalId(),
      body: s.body,
      imageKey: s.imageKey ?? null,
      imageUrl: s.imageUrl ?? null,
    })),
    lastAddedRowId: null,
  };
}

// --- reducer ------------------------------------------------------

export type RecipeFormAction =
  | { type: "setField"; field: "title" | "description" | "servings"; value: string }
  | { type: "setIsPublic"; value: boolean }
  | { type: "addGroup" }
  | { type: "removeGroup"; groupId: string }
  | { type: "renameGroup"; groupId: string; name: string }
  | { type: "moveGroup"; groupId: string; direction: "up" | "down" }
  | { type: "addIngredient"; groupId: string }
  | { type: "removeIngredient"; groupId: string; ingredientId: string }
  | {
      type: "setIngredientField";
      groupId: string;
      ingredientId: string;
      field: "name" | "quantity" | "unit";
      value: string;
    }
  | { type: "moveIngredient"; groupId: string; ingredientId: string; direction: "up" | "down" }
  | { type: "moveIngredientToGroup"; ingredientId: string; toGroupId: string }
  | { type: "linkRefRecipe"; ingredientId: string; recipeId: string; title: string }
  | { type: "unlinkRefRecipe"; ingredientId: string }
  | { type: "setThumbnailKey"; key: string | null; url: string | null }
  | { type: "addStep" }
  | { type: "removeStep"; stepId: string }
  | { type: "setStepBody"; stepId: string; value: string }
  | { type: "setStepImageKey"; stepId: string; key: string | null; url: string | null }
  | { type: "moveStep"; stepId: string; direction: "up" | "down" }
  | { type: "clearLastAdded" }
  | { type: "hydrate"; state: RecipeFormState };

function swap<T>(list: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function mapGroup(
  state: RecipeFormState,
  groupId: string,
  fn: (g: GroupRow) => GroupRow,
): RecipeFormState {
  return { ...state, groups: state.groups.map((g) => (g.localId === groupId ? fn(g) : g)) };
}

function mapIngredient(
  group: GroupRow,
  ingredientId: string,
  fn: (i: IngredientRow) => IngredientRow,
): GroupRow {
  return {
    ...group,
    ingredients: group.ingredients.map((i) => (i.localId === ingredientId ? fn(i) : i)),
  };
}

/** 全グループを横断して材料行を書き換える（グループをまたぐ操作＝リンク等で使う）。 */
function mapIngredientAcross(
  state: RecipeFormState,
  ingredientId: string,
  fn: (i: IngredientRow) => IngredientRow,
): RecipeFormState {
  return {
    ...state,
    groups: state.groups.map((g) => mapIngredient(g, ingredientId, fn)),
  };
}

export function recipeFormReducer(
  state: RecipeFormState,
  action: RecipeFormAction,
): RecipeFormState {
  switch (action.type) {
    case "hydrate":
      return action.state;

    case "clearLastAdded":
      return state.lastAddedRowId === null ? state : { ...state, lastAddedRowId: null };

    case "setField":
      return { ...state, [action.field]: action.value };

    case "setIsPublic":
      return { ...state, isPublic: action.value };

    // --- サムネイル ---
    case "setThumbnailKey":
      // キーと表示 URL は必ずセットで入れ替える。URL は `POST /images` の
      // レスポンスに含まれる（クライアントではキーから組み立てられない）。
      // 片方だけ更新すると、古い画像が表示されたままになる。
      return { ...state, thumbnailKey: action.key, thumbnailUrl: action.url };

    // --- グループ ---
    case "addGroup": {
      const ing = emptyIngredient();
      return {
        ...state,
        groups: [...state.groups, { localId: makeLocalId(), name: "", ingredients: [ing] }],
        lastAddedRowId: ing.localId,
      };
    }
    case "removeGroup":
      // 最後の 1 グループは消せない（レシピは 1 グループ以上・recipe.md §3）。
      if (state.groups.length <= 1) return state;
      return { ...state, groups: state.groups.filter((g) => g.localId !== action.groupId) };
    case "renameGroup":
      return mapGroup(state, action.groupId, (g) => ({ ...g, name: action.name }));
    case "moveGroup": {
      const idx = state.groups.findIndex((g) => g.localId === action.groupId);
      return {
        ...state,
        groups: swap(state.groups, idx, action.direction === "up" ? idx - 1 : idx + 1),
      };
    }

    // --- 材料行 ---
    case "addIngredient": {
      const ing = emptyIngredient();
      return {
        ...mapGroup(state, action.groupId, (g) => ({
          ...g,
          ingredients: [...g.ingredients, ing],
        })),
        lastAddedRowId: ing.localId,
      };
    }
    case "removeIngredient":
      return mapGroup(state, action.groupId, (g) =>
        // グループ内最後の 1 行は消せない（グループは材料 1 件以上）。グループごと
        // 消したいときは removeGroup を使う。
        g.ingredients.length <= 1
          ? g
          : { ...g, ingredients: g.ingredients.filter((i) => i.localId !== action.ingredientId) },
      );
    case "setIngredientField":
      return mapGroup(state, action.groupId, (g) =>
        mapIngredient(g, action.ingredientId, (i) => ({ ...i, [action.field]: action.value })),
      );
    case "moveIngredient":
      return mapGroup(state, action.groupId, (g) => {
        const idx = g.ingredients.findIndex((i) => i.localId === action.ingredientId);
        return {
          ...g,
          ingredients: swap(g.ingredients, idx, action.direction === "up" ? idx - 1 : idx + 1),
        };
      });
    case "moveIngredientToGroup": {
      const from = state.groups.find((g) =>
        g.ingredients.some((i) => i.localId === action.ingredientId),
      );
      if (!from || from.localId === action.toGroupId) return state;
      // 移動元がその材料 1 件だけなら、空グループになるので移動を許さない
      // （removeGroup で消す運用。recipe.md §3「グループは材料 1 件以上」）。
      if (from.ingredients.length <= 1) return state;
      const moving = from.ingredients.find((i) => i.localId === action.ingredientId);
      if (!moving) return state;
      return {
        ...state,
        groups: state.groups.map((g) => {
          if (g.localId === from.localId) {
            return {
              ...g,
              ingredients: g.ingredients.filter((i) => i.localId !== action.ingredientId),
            };
          }
          if (g.localId === action.toGroupId) {
            // 移動先グループの末尾に付ける（recipe-editor.md §5）。
            return { ...g, ingredients: [...g.ingredients, moving] };
          }
          return g;
        }),
      };
    }

    // --- 材料のレシピ参照 ---
    case "linkRefRecipe":
      return mapIngredientAcross(state, action.ingredientId, (i) => ({
        ...i,
        refRecipeId: action.recipeId,
        refRecipeTitle: action.title,
        // name が空なら参照先タイトルを 60 文字に丸めて自動入力（recipe.md §2）。
        name: i.name.trim() === "" ? action.title.slice(0, 60) : i.name,
      }));
    case "unlinkRefRecipe":
      return mapIngredientAcross(state, action.ingredientId, (i) => ({
        ...i,
        refRecipeId: null,
        refRecipeTitle: null,
      }));

    // --- 手順 ---
    case "addStep": {
      const step: StepRow = { localId: makeLocalId(), body: "", imageKey: null, imageUrl: null };
      return { ...state, steps: [...state.steps, step], lastAddedRowId: step.localId };
    }
    case "removeStep":
      if (state.steps.length <= 1) return state;
      return { ...state, steps: state.steps.filter((s) => s.localId !== action.stepId) };
    case "setStepBody":
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.localId === action.stepId ? { ...s, body: action.value } : s,
        ),
      };
    case "setStepImageKey":
      // サムネイルと同じく、キーと表示 URL はセットで入れ替える。
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.localId === action.stepId ? { ...s, imageKey: action.key, imageUrl: action.url } : s,
        ),
      };
    case "moveStep": {
      const idx = state.steps.findIndex((s) => s.localId === action.stepId);
      return {
        ...state,
        steps: swap(state.steps, idx, action.direction === "up" ? idx - 1 : idx + 1),
      };
    }
  }
}

// --- 送信用 body への変換 -----------------------------------------

function isIngredientEmpty(i: IngredientRow): boolean {
  return (
    i.name.trim() === "" &&
    i.quantity.trim() === "" &&
    i.unit.trim() === "" &&
    i.refRecipeId === null
  );
}

/**
 * 送信 body ＋「送信された各グループ / 材料 / 手順が、フォーム上のどの行
 * （localId）だったか」の対応表。サーバー 400 の `details.errors[].loc`
 * （配列インデックス）を、該当行の下のエラー表示へ翻訳するのに使う。
 */
export type RecipeSubmission = {
  body: RecipeWriteRequest;
  /** 送信された i 番目のグループの localId */
  groupIds: string[];
  /** 送信された i 番目のグループの、j 番目の材料の localId */
  ingredientIds: string[][];
  /** 送信された i 番目の手順の localId */
  stepIds: string[];
};

/**
 * フォーム状態を送信 body ＋ 対応表に変換する（POST / PUT 共通）。
 *
 * 送信前の正規化（recipe.md §2・§3）:
 * - 本文が空 / 空白のみの手順行を除外
 * - 完全に空の材料行を除外し、その結果 0 件になったグループを除外
 * - `position` はサーバーが配列順から振るので送らない
 *
 * ## `thumbnailKey` の送り方が作成と編集で違う理由
 *
 * サーバーは PUT の `thumbnailKey` を「**省略 = 現状維持 / null = 削除 /
 * キー = そのキーにする**」と解釈する（features/image.md §3）。
 *
 * - **作成（POST）**: まだ何も無いので「維持」に意味が無い。値があるときだけ送る
 * - **編集（PUT）**: **必ず送る**（値または null）。省略すると「サーバーが今
 *   持っている値のまま」になり、利用者が画面で削除したのに消えない、といった
 *   食い違いが起きる。画面に見えている状態をそのまま送るのが安全
 *
 * 同じキーを送り直すのは仕様上「維持」として正しく扱われる（サーバーは
 * 「このレシピに既に紐付いているキー」を再検証せず通す）。
 */
export function buildSubmission(
  state: RecipeFormState,
  { mode }: { mode: "create" | "edit" },
): RecipeSubmission {
  const groupIds: string[] = [];
  const ingredientIds: string[][] = [];

  const groups = state.groups
    .map((g) => {
      const keptIngredients = g.ingredients.filter((i) => !isIngredientEmpty(i));
      return {
        group: g,
        keptIngredients,
        payload: {
          name: g.name.trim() === "" ? null : g.name.trim(),
          ingredients: keptIngredients.map((i) => ({
            name: i.name.trim(),
            quantity: i.quantity.trim() === "" ? null : i.quantity.trim(),
            unit: i.unit.trim() === "" ? null : i.unit.trim(),
            refRecipeId: i.refRecipeId,
          })),
        },
      };
    })
    .filter((g) => g.keptIngredients.length > 0);

  for (const g of groups) {
    groupIds.push(g.group.localId);
    ingredientIds.push(g.keptIngredients.map((i) => i.localId));
  }

  const stepIds: string[] = [];
  const steps: { body: string; imageKey?: string | null }[] = [];
  for (const s of state.steps) {
    const trimmed = s.body.trim();
    if (trimmed === "") continue;
    stepIds.push(s.localId);
    // 既存の画像キーがあれば再送して画像を維持する（recipe.md §5）。
    // 無ければ imageKey を省略（= 画像なし）。
    steps.push(s.imageKey ? { body: trimmed, imageKey: s.imageKey } : { body: trimmed });
  }

  const body: RecipeWriteRequest = {
    title: state.title.trim(),
    description: state.description,
    servings: Number(state.servings),
    isPublic: state.isPublic,
    ingredientGroups: groups.map((g) => g.payload),
    steps,
  };

  // 上のコメントのとおり、編集は必ず送り、作成は値があるときだけ送る。
  if (mode === "edit" || state.thumbnailKey !== null) {
    body.thumbnailKey = state.thumbnailKey;
  }

  return { body, groupIds, ingredientIds, stepIds };
}

/** 送信 body だけが欲しいとき（対応表が不要なテスト等）。 */
export function toWriteRequest(
  state: RecipeFormState,
  options: { mode: "create" | "edit" } = { mode: "create" },
): RecipeWriteRequest {
  return buildSubmission(state, options).body;
}

// --- 未保存判定（dirty） -----------------------------------------

/**
 * `current` が `baseline` から実質的に変化しているか。
 * `localId` / `lastAddedRowId` は表示・操作のための一時値なので比較対象から外す。
 *
 * 画像は **`imageKey` を比較対象に含める**。ここに含めないと、画像だけ
 * 差し替えて閉じたときに「未保存の変更あり」と判定されず、確認ダイアログが
 * 出ないまま編集内容が失われる（#40 で修正）。
 * 一方 `imageUrl` は含めない。キーが同じなら同じ画像を指しており、URL は
 * サーバーが組み立てる派生値にすぎないため。
 */
export function isDirty(current: RecipeFormState, baseline: RecipeFormState): boolean {
  const strip = (s: RecipeFormState) => ({
    title: s.title,
    description: s.description,
    servings: s.servings,
    isPublic: s.isPublic,
    thumbnailKey: s.thumbnailKey,
    groups: s.groups.map((g) => ({
      name: g.name,
      ingredients: g.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        refRecipeId: i.refRecipeId,
      })),
    })),
    steps: s.steps.map((st) => ({ body: st.body, imageKey: st.imageKey })),
  });
  return JSON.stringify(strip(current)) !== JSON.stringify(strip(baseline));
}
