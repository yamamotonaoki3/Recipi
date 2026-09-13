/**
 * ナビゲーションの destination（タブ）の定義（screens/navigation.md）。
 *
 * ルート構造の都合で複数箇所（タブのシェル・レシピエディタ）から同じ一覧を
 * 参照するため、1 か所にまとめる。
 */

/**
 * レシピ詳細を push できるスタックを持つ destination。
 *
 * `(tabs)/<name>/recipes/[id].tsx` があるものだけ。
 */
export const DESTINATIONS_WITH_RECIPE_STACK = [
  "/home",
  "/history",
  "/notifications",
  "/my-page",
] as const;

export type RecipeStackDestination = (typeof DESTINATIONS_WITH_RECIPE_STACK)[number];

/**
 * 外から渡された遷移先を、既知の destination だけに絞り込む。
 *
 * エディタの戻り先は URL のクエリ（`?from=...`）で渡している。**外部から
 * 任意の値を入れられる入口**なので、`https://...` のような外部 URL を
 * そのまま `router.dismissTo` に渡すと、保存後に攻撃者のサイトへ飛ばされうる
 * （Codex #42 レビュー指摘）。許可リストに無い値はホームに倒す。
 */
export function resolveRecipeStackDestination(value: string | undefined): RecipeStackDestination {
  const match = DESTINATIONS_WITH_RECIPE_STACK.find((href) => href === value);
  return match ?? "/home";
}
