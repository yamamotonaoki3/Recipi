/**
 * ユーザープロフィール（他人）（screens/user-profile.md。Issue #96）。
 *
 * 上から: アバター＋表示名 → フォロー数 / フォロワー数 → フォローボタン →
 * 公開 ON の連絡先・SNS → その人の公開レシピ一覧（無限スクロール）。
 *
 * 自分の ID で開かれたらマイページへ置き換える（自分自身のプロフィールはマイページ）。
 * 画面本体は 1 つで、各 destination（ホーム / 履歴 / マイページ）のスタックから
 * `basePath` を変えて使う（lessons #42-7）。
 */
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { RecipeCard } from "@/components/RecipeCard";
import { FollowButton } from "@/components/UserRow";
import { ApiError } from "@/features/auth/api";
import { useToggleFollow } from "@/features/follow/hooks";
import type { UserPublicProfile, UserSelfProfile } from "@/features/profile/api";
import { useUserProfile, useUserRecipes } from "@/features/profile/userHooks";
import { useSession } from "@/store/session";

type LinkItem = { key: string; label: string; value: string; url: string };

/** 公開 ON の連絡先・SNS だけを並べる（非公開の項目はサーバーが返さない）。 */
function toLinkItems(profile: UserPublicProfile): LinkItem[] {
  const items: LinkItem[] = [];
  if (profile.email) {
    items.push({
      key: "email",
      label: "メール",
      value: profile.email,
      url: `mailto:${profile.email}`,
    });
  }
  const { x, instagram, other } = profile.links;
  if (x) items.push({ key: "x", label: "X", value: x, url: x });
  if (instagram)
    items.push({ key: "instagram", label: "Instagram", value: instagram, url: instagram });
  if (other) items.push({ key: "other", label: "その他", value: other, url: other });
  return items;
}

/** 本人向けの形（公開トグルを持つ）が返ったか。自分を開いたときにだけ起きる。 */
function isSelfProfile(profile: UserPublicProfile | UserSelfProfile): profile is UserSelfProfile {
  return "emailPublic" in profile;
}

export function UserProfileScreen({ basePath }: { basePath: string }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myId = useSession((s) => s.user?.id);
  const isMe = myId != null && id === myId;

  // hook は条件付きで呼べないので、自分のときは ID を渡さず「送らない」にする。
  const profileQuery = useUserProfile(isMe ? undefined : id);
  const recipesQuery = useUserRecipes(isMe ? undefined : id);
  const toggleFollow = useToggleFollow();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace(basePath as never);
  }

  if (isMe || (profileQuery.data && isSelfProfile(profileQuery.data))) {
    return <Redirect href="/my-page" />;
  }

  const header = (title: string) => (
    <View className="flex-row items-center gap-3 border-b border-neutral-200 px-4 py-3">
      <Pressable testID="user-profile-back" onPress={goBack} accessibilityRole="button">
        <Text className="text-neutral-500">← 戻る</Text>
      </Pressable>
      <Text numberOfLines={1} className="flex-1 text-base font-bold text-neutral-900">
        {title}
      </Text>
    </View>
  );

  if (profileQuery.isPending) {
    return (
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        {header("")}
        <View testID="user-profile-skeleton" className="items-center gap-3 p-6">
          <View className="h-20 w-20 rounded-full bg-neutral-100" />
          <View className="h-5 w-32 rounded bg-neutral-100" />
          <View className="h-4 w-48 rounded bg-neutral-100" />
        </View>
      </View>
    );
  }

  if (profileQuery.isError) {
    const notFound = profileQuery.error instanceof ApiError && profileQuery.error.status === 404;
    return (
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
        {header("")}
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-neutral-600">
            {notFound ? "このユーザーは見つかりません" : "読み込みに失敗しました"}
          </Text>
          {!notFound && (
            <Pressable
              testID="user-profile-retry"
              onPress={() => void profileQuery.refetch()}
              accessibilityRole="button"
              className="rounded-lg border border-neutral-300 px-4 py-2"
            >
              <Text className="text-neutral-700">再試行</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const profile = profileQuery.data as UserPublicProfile;
  const links = toLinkItems(profile);
  const recipes = recipesQuery.data?.pages.flatMap((p) => p.items) ?? [];

  function openConnections(tab: "following" | "followers") {
    router.push(`${basePath}/users/${profile.id}/connections?tab=${tab}` as never);
  }

  const profileSection = (
    <View className="gap-4 px-4 pb-4 pt-6">
      <View className="items-center gap-2">
        <Avatar
          url={profile.avatarUrl}
          displayName={profile.displayName}
          size={80}
          testID="user-profile-avatar"
        />
        <Text testID="user-profile-display-name" className="text-xl font-semibold text-neutral-900">
          {profile.displayName}
        </Text>
      </View>

      <View className="flex-row justify-center gap-6">
        <Pressable
          testID="user-profile-following"
          onPress={() => openConnections("following")}
          accessibilityRole="button"
        >
          <Text className="text-sm text-neutral-600">
            <Text className="font-semibold text-neutral-900">{profile.followingCount}</Text>{" "}
            フォロー
          </Text>
        </Pressable>
        <Pressable
          testID="user-profile-followers"
          onPress={() => openConnections("followers")}
          accessibilityRole="button"
        >
          <Text className="text-sm text-neutral-600">
            <Text className="font-semibold text-neutral-900">{profile.followerCount}</Text>{" "}
            フォロワー
          </Text>
        </Pressable>
      </View>

      <View className="items-center">
        <FollowButton
          testID="user-profile-follow"
          isFollowing={profile.isFollowing}
          pending={toggleFollow.isPending}
          onPress={() => toggleFollow.mutate({ userId: profile.id, follow: !profile.isFollowing })}
        />
      </View>

      {links.length > 0 && (
        <View testID="user-profile-links" className="gap-2 rounded-xl bg-neutral-50 p-3">
          {links.map((link) => (
            <Pressable
              key={link.key}
              testID={`user-profile-link-${link.key}`}
              // 外部ブラウザ / メールアプリで開く。開けなくても画面には影響させない。
              onPress={() => void Linking.openURL(link.url).catch(() => undefined)}
              accessibilityRole="link"
              className="flex-row gap-2"
            >
              <Text className="w-20 text-sm text-neutral-500">{link.label}</Text>
              <Text numberOfLines={1} className="flex-1 text-sm text-blue-600">
                {link.value}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text className="mt-2 text-base font-bold text-neutral-900">公開レシピ</Text>
      {recipesQuery.isError && (
        <View className="flex-row items-center gap-3">
          <Text className="text-sm text-neutral-500">レシピの読み込みに失敗しました</Text>
          <Pressable
            testID="user-profile-recipes-retry"
            onPress={() => void recipesQuery.refetch()}
            accessibilityRole="button"
          >
            <Text className="text-sm text-blue-600">再試行</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {header(profile.displayName)}
      <FlatList
        testID="user-profile-list"
        data={recipes}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={profileSection}
        contentContainerClassName="gap-2 pb-6"
        renderItem={({ item }) => (
          <View className="px-4">
            <RecipeCard
              testID={`user-recipe-${item.id}`}
              recipe={item}
              onPress={() => router.push(`${basePath}/recipes/${item.id}` as never)}
            />
          </View>
        )}
        ListEmptyComponent={
          recipesQuery.isPending ? (
            <ActivityIndicator className="my-6" />
          ) : recipesQuery.isError ? null : (
            <Text testID="user-profile-recipes-empty" className="mt-6 text-center text-neutral-500">
              まだ公開レシピがありません
            </Text>
          )
        }
        onEndReached={() => {
          if (recipesQuery.hasNextPage && !recipesQuery.isFetchingNextPage) {
            void recipesQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          recipesQuery.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null
        }
      />
    </View>
  );
}
