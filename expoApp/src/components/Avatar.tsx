/**
 * ユーザーのアバター（丸いアイコン）。Issue #94。
 *
 * レシピカード・レシピ詳細の投稿者・マイページ・プロフィール編集で共用する。
 * アバター未設定（`url` が null）のときは、表示名の頭文字を入れた丸を出す
 * （デフォルト画像は未確定。features/profile.md §8 → todo #15）。
 *
 * `testID` を渡すと、画像には `testID`、頭文字の丸には `${testID}-placeholder`
 * が付く（どちらが出ているかをテストで見分けられるように）。
 */
import { Image } from "expo-image";
import { Text, View } from "react-native";

type AvatarProps = {
  url: string | null | undefined;
  displayName: string;
  /** 直径（px）。 */
  size: number;
  testID?: string;
};

export function Avatar({ url, displayName, size, testID }: AvatarProps) {
  if (url) {
    return (
      <Image
        testID={testID}
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        accessibilityLabel={`${displayName}のアバター`}
      />
    );
  }

  return (
    <View
      testID={testID ? `${testID}-placeholder` : undefined}
      className="items-center justify-center bg-neutral-200"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      {/* 文字の大きさは丸の半分くらいにする（小さい丸でもはみ出さないように）。 */}
      <Text className="text-neutral-500" style={{ fontSize: Math.max(8, size / 2) }}>
        {Array.from(displayName)[0] ?? ""}
      </Text>
    </View>
  );
}
