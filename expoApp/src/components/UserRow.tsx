/**
 * ユーザー行（screens/components.md §ユーザー行。Issue #96）。
 *
 * アバター ＋ 表示名 ＋ フォロー状態ボタン（「フォロー」/「フォロー中」）。
 * 自分自身の行にはボタンを出さない（`showFollowButton={false}`）。
 * ボタン以外の領域をタップすると `onPress`（プロフィールへ移動）。
 */
import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";

type UserRowProps = {
  displayName: string;
  avatarUrl: string | null | undefined;
  isFollowing: boolean;
  showFollowButton: boolean;
  /** フォロー / 解除の送信中。二重に押せないようボタンを止める。 */
  pending?: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
  testID: string;
};

export function UserRow({
  displayName,
  avatarUrl,
  isFollowing,
  showFollowButton,
  pending = false,
  onPress,
  onToggleFollow,
  testID,
}: UserRowProps) {
  return (
    <View className="flex-row items-center gap-3 border-b border-neutral-100 px-4 py-3">
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        className="flex-1 flex-row items-center gap-3"
      >
        <Avatar url={avatarUrl} displayName={displayName} size={40} testID={`${testID}-avatar`} />
        <Text numberOfLines={1} className="flex-1 text-base text-neutral-900">
          {displayName}
        </Text>
      </Pressable>

      {showFollowButton && (
        <FollowButton
          isFollowing={isFollowing}
          pending={pending}
          onPress={onToggleFollow}
          testID={`${testID}-follow`}
          size="small"
        />
      )}
    </View>
  );
}

/**
 * フォロー状態ボタン。プロフィール画面とユーザー行で共用する。
 *
 * フォロー中は白地（押すと解除）、未フォローはオレンジ（押すとフォロー）。
 */
export function FollowButton({
  isFollowing,
  pending,
  onPress,
  testID,
  size = "normal",
}: {
  isFollowing: boolean;
  pending: boolean;
  onPress: () => void;
  testID: string;
  size?: "normal" | "small";
}) {
  const padding = size === "small" ? "px-3 py-1.5" : "px-5 py-2";
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityState={{ selected: isFollowing, disabled: pending }}
      className={`rounded-full ${padding} ${
        isFollowing ? "border border-neutral-300 bg-white" : "bg-orange-500"
      } ${pending ? "opacity-60" : ""}`}
    >
      <Text className={`text-sm font-semibold ${isFollowing ? "text-neutral-700" : "text-white"}`}>
        {isFollowing ? "フォロー中" : "フォロー"}
      </Text>
    </Pressable>
  );
}
