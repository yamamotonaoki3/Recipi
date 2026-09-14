/**
 * 読み込み中に出す「骨組み」（スケルトン。Issue #133）。
 *
 * 画面仕様（home.md / history.md / my-recipes.md / recipe-detail.md §4）は、初回の読み込み中を
 * スピナーではなくスケルトンにすると決めている。これから出る中身の形を先に見せることで、
 * 何が表示されるのかが分かり、表示が切り替わったときのガタつきも小さくなる。
 *
 * 見た目は既存のスケルトン（通知・フォロー／フォロワー・他人のプロフィール）にそろえ、
 * 薄い灰色の角丸のブロックだけで組み立てる。
 */
import { View } from "react-native";

/** 薄い灰色の角丸ブロック（スケルトンの最小単位）。 */
function Block({ className }: { className: string }) {
  return <View className={`rounded bg-neutral-100 ${className}`} />;
}

/**
 * レシピカードの一覧のスケルトン（ホーム・閲覧履歴・自分のレシピ）。
 * カードと同じく「サムネイル＋タイトル＋投稿者」の形を 4 枚並べる。
 */
export function RecipeCardSkeletonList({ testID, count = 4 }: { testID: string; count?: number }) {
  return (
    <View testID={testID} className="gap-2 p-4">
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          className="flex-row gap-3 rounded-xl border border-neutral-100 bg-white p-3"
        >
          <Block className="h-16 w-16 rounded-lg" />
          <View className="flex-1 justify-center gap-2">
            <Block className="h-4 w-3/4" />
            <Block className="h-3 w-1/3" />
          </View>
        </View>
      ))}
    </View>
  );
}

/** レシピ詳細のスケルトン（サムネイル 4:3・タイトル・メタ・本文の行）。 */
export function RecipeDetailSkeleton({ testID }: { testID: string }) {
  return (
    <View testID={testID} className="gap-4 p-4">
      {/* 実際のサムネイルと同じ 4:3 の枠（RecipeDetailScreen の画像枠と同じ比率）。 */}
      <View className="w-full rounded-xl bg-neutral-100" style={{ aspectRatio: 4 / 3 }} />
      <Block className="h-7 w-2/3" />
      <View className="flex-row items-center gap-2">
        <Block className="h-6 w-6 rounded-full" />
        <Block className="h-4 w-24" />
      </View>
      <Block className="h-4 w-20" />
      <View className="gap-2">
        <Block className="h-4 w-full" />
        <Block className="h-4 w-11/12" />
        <Block className="h-4 w-4/5" />
      </View>
    </View>
  );
}
