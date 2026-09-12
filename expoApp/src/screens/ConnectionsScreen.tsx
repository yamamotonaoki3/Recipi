/**
 * フォロー・フォロワー（screens/connections.md。Issue #96）。
 *
 * 上部タブ「フォロー中」「フォロワー」＋ユーザー行のリスト（無限スクロール）。
 * 自分のもの（マイページから）と他人のもの（その人のプロフィールから）を同じ画面で扱う。
 *
 * - 自分: `self` を付けてルートから使う（`/users/me/following` などを呼ぶ）
 * - 他人: URL の `id` の人の一覧（`/users/{id}/following` などを呼ぶ）
 * - 初期タブは URL の `?tab=followers` で選べる（既定はフォロー中）
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserRow } from "@/components/UserRow";
import type { ConnectionTab, UserRow as UserRowData } from "@/features/follow/api";
import { useConnections, useToggleFollow } from "@/features/follow/hooks";
import { useUserProfile } from "@/features/profile/userHooks";
import { useSession } from "@/store/session";

const TABS: { key: ConnectionTab; label: string; empty: string }[] = [
  { key: "following", label: "フォロー中", empty: "まだ誰もフォローしていません" },
  { key: "followers", label: "フォロワー", empty: "まだフォロワーがいません" },
];

export function ConnectionsScreen({
  basePath,
  self = false,
}: {
  basePath: string;
  self?: boolean;
}) {
  const params = useLocalSearchParams<{ id?: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myId = useSession((s) => s.user?.id);

  const [tab, setTab] = useState<ConnectionTab>(
    params.tab === "followers" ? "followers" : "following",
  );

  // 自分の一覧か、URL の人の一覧か。自分の ID を他人用の URL で開いた場合も自分として扱う。
  const target = self || (myId != null && params.id === myId) ? "me" : params.id;
  const titleQuery = useUserProfile(target === "me" ? undefined : target);
  const title = target === "me" ? "フォロー・フォロワー" : (titleQuery.data?.displayName ?? "");

  const query = useConnections(target, tab);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace(basePath as never);
  }

  function openUser(row: UserRowData) {
    // 自分の行ならマイページ、他人ならその人のプロフィール（connections.md §5）。
    if (row.id === myId) router.navigate("/my-page" as never);
    else router.push(`${basePath}/users/${row.id}` as never);
  }

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <Pressable testID="connections-back" onPress={goBack} accessibilityRole="button">
          <Text className="text-neutral-500">← 戻る</Text>
        </Pressable>
        <Text numberOfLines={1} className="flex-1 text-base font-bold text-neutral-900">
          {title}
        </Text>
      </View>

      <View className="flex-row border-b border-neutral-200">
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            testID={`connections-tab-${t.key}`}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            className={`flex-1 items-center py-3 ${
              tab === t.key ? "border-b-2 border-orange-500" : ""
            }`}
          >
            <Text className={tab === t.key ? "font-semibold text-orange-600" : "text-neutral-500"}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {query.isPending ? (
        <View testID="connections-skeleton" className="gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <View key={i} className="h-12 rounded-lg bg-neutral-100" />
          ))}
        </View>
      ) : query.isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-neutral-600">読み込みに失敗しました</Text>
          <Pressable
            testID="connections-retry"
            onPress={() => void query.refetch()}
            accessibilityRole="button"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          >
            <Text className="text-neutral-700">再試行</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="connections-list"
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <ConnectionRow row={item} isMe={item.id === myId} onPress={() => openUser(item)} />
          )}
          ListEmptyComponent={
            <Text testID="connections-empty" className="mt-10 text-center text-neutral-500">
              {current.empty}
            </Text>
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            query.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null
          }
        />
      )}
    </View>
  );
}

/**
 * 一覧の 1 行。行ごとにフォローの送信状態を持たせるため、hook をここで呼ぶ
 * （1 つの hook を全行で共有すると、1 行の送信中に全行のボタンが止まる）。
 */
function ConnectionRow({
  row,
  isMe,
  onPress,
}: {
  row: UserRowData;
  isMe: boolean;
  onPress: () => void;
}) {
  const toggleFollow = useToggleFollow();
  return (
    <UserRow
      testID={`connections-row-${row.id}`}
      displayName={row.displayName}
      avatarUrl={row.avatarUrl}
      isFollowing={row.isFollowing}
      showFollowButton={!isMe}
      pending={toggleFollow.isPending}
      onPress={onPress}
      onToggleFollow={() => toggleFollow.mutate({ userId: row.id, follow: !row.isFollowing })}
    />
  );
}
