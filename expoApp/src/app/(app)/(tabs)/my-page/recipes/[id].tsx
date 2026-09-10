import { RecipeDetailScreen } from "@/screens/RecipeDetailScreen";

/** 自分のレシピ一覧から開いたレシピ詳細（マイページのスタックに積む）。 */
export default function Screen() {
  return <RecipeDetailScreen basePath="/my-page" />;
}
