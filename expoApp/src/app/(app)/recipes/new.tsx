/**
 * レシピ作成（screens/recipe-editor.md）。入口はボトムナビ / レールの「＋」。
 *
 * `from` は「＋ を押したときに居た destination」（`/home` など）。
 * 保存後はその destination のスタック内の詳細へ遷移したいので受け取る
 * （destination ごとにスタックが分かれている。screens/navigation.md）。
 */
import { useLocalSearchParams } from "expo-router";

import { RecipeEditor } from "@/features/recipe/RecipeEditor";

export default function NewRecipeScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  return <RecipeEditor mode="create" basePath={from} />;
}
