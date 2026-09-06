/**
 * レシピ作成（screens/recipe-editor.md）。ボトムナビ「＋」の入口は #42。
 * 当面は (app)/index.tsx の一時リンクから来る。
 */
import { RecipeEditor } from "@/features/recipe/RecipeEditor";

export default function NewRecipeScreen() {
  return <RecipeEditor mode="create" />;
}
