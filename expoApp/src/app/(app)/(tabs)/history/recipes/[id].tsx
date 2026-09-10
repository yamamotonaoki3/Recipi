import { RecipeDetailScreen } from "@/screens/RecipeDetailScreen";

/** 履歴から開いたレシピ詳細（履歴のスタックに積む）。 */
export default function Screen() {
  return <RecipeDetailScreen basePath="/history" />;
}
