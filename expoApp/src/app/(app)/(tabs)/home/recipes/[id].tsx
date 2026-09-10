import { RecipeDetailScreen } from "@/screens/RecipeDetailScreen";

/** ホームから開いたレシピ詳細（ホームのスタックに積む）。 */
export default function Screen() {
  return <RecipeDetailScreen basePath="/home" />;
}
