/**
 * レシピ編集（screens/recipe-editor.md）。詳細画面の「編集」から来る。
 *
 * 編集モードは初期値をサーバーから取得する必要があるため、`useRecipe` で
 * ロードしてから `RecipeEditor` に渡す。他人のレシピ（403/404）はここで弾く。
 *
 * `RecipeEditor` はフォーム状態を初回マウント時に 1 回だけ作り、以後 recipe
 * prop の変化を無視する。通常の導線（詳細 → 編集）ではその直前に詳細画面が
 * 同じ `["recipe", id]` を新鮮化しているので初期値のズレは実質起きないが、
 * 「キャッシュが古い状態で編集を開き、開いた後に再取得で値が変わる」ケースの
 * 追随は将来対応（Codex #38 レビュー・P2。todo に記録）。
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { RecipeEditor } from "@/features/recipe/RecipeEditor";
import { useRecipe } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

export default function EditRecipeScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const { data, isPending, isError } = useRecipe(id);
  const currentUserId = useSession((s) => s.user?.id);

  // 保護ルートへの直接ディープリンクでは、セッション復元より先にこの画面が
  // マウントされ currentUserId が一瞬 null になりうる（profile-edit と同じ）。
  // その間はローディング表示にし、所有者判定は user が入ってから行う。
  if (isPending || (data != null && currentUserId == null)) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  // 他人のレシピ（公開でも）は編集画面を開かせない。直接 URL を叩かれた場合の
  // ガード（サーバー PUT も 403 で弾くが、その前に UI で止める）。
  const isOwner = data != null && currentUserId != null && data.author.id === currentUserId;

  if (isError || !data || !isOwner) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white p-6">
        <Text className="text-neutral-600">表示できません</Text>
        <Pressable
          testID="recipe-edit-back"
          onPress={() => router.back()}
          accessibilityRole="button"
          className="rounded-lg border border-neutral-300 px-4 py-2"
        >
          <Text className="text-neutral-700">前の画面へ戻る</Text>
        </Pressable>
      </View>
    );
  }

  return <RecipeEditor mode="edit" recipe={data} basePath={from} />;
}
