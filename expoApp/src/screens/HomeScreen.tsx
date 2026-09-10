/**
 * ホーム（screens/home.md）。
 *
 * 上から「ロゴ → 常時固定の検索窓 → サブタブ → レシピカードの縦リスト」。
 * MVP で機能するのは「全体」タブ ＋ 検索だけで、他 3 タブは「準備中」を出す
 * （Issue #42 の確定事項。サーバーも `feed=all` 以外を 400 で弾く）。
 *
 * `basePath` は「この画面が属する destination のスタックの根」。
 * ナビゲーションバーを出したまま詳細などを push するため、destination ごとに
 * 別スタック（/home・/history・/my-page）を持たせており、push 先はその中に
 * 収める必要がある（screens/navigation.md「各 destination は独立した
 * ナビゲーションスタックを保持する」）。
 */
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FeedRecipeCard } from "@/components/FeedRecipeCard";
import { useFeed } from "@/features/feed/hooks";

/** サブタブ。`ready: false` は Phase 5・6 で有効化する（home-feed.md §1）。 */
const SUB_TABS = [
  { key: "all", label: "全体", ready: true },
  { key: "following", label: "フォロー", ready: false },
  { key: "followers", label: "フォロワー", ready: false },
  { key: "favorites", label: "お気に入りレシピ", ready: false },
] as const;

type SubTabKey = (typeof SUB_TABS)[number]["key"];

export function HomeScreen({ basePath }: { basePath: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // 検索窓の「入力中の文字」と「確定した検索語」は別物。
  // home.md §5 のとおり、確定（Enter / 検索キー）で初めて絞り込みが走る。
  const [input, setInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SubTabKey>("all");

  const isReadyTab = SUB_TABS.find((t) => t.key === activeTab)?.ready ?? false;
  // 準備中タブを選んでいる間は API を呼ばない（呼ぶと 400 になる）。
  const feed = useFeed(submittedQuery, { enabled: isReadyTab });

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const hasQuery = submittedQuery !== "";

  const clearSearch = () => {
    setInput("");
    setSubmittedQuery("");
  };

  /**
   * 検索を確定する。検索ボタンと、キーボードの確定キー（`onSubmitEditing`）の
   * 両方から呼ぶ。
   *
   * **確定手段をキーだけにしない**のは、Android では確定が IME のアクション
   * でしか起きず、IME の実装や外部キーボードの有無に左右されるため
   * （Android E2E が実際にここで詰まった。Issue #74）。押せるボタンがあれば
   * 経路がひとつ増え、利用者にも「どうすれば検索できるか」が見える。
   */
  const submitSearch = () => {
    setSubmittedQuery(input.trim());
  };

  /**
   * 入力が変わったときの処理。
   *
   * 「検索語を消すと通常フィード表示に戻る」（home.md §2）ので、**空にした
   * 時点で確定済みの検索語も落とす**。`setInput` だけにしていると、× を
   * 押さずにバックスペースで消したときにチップと絞り込みが残ってしまう
   * （Codex #42 レビュー指摘）。
   */
  const handleChangeText = (next: string) => {
    setInput(next);
    if (next.trim() === "") setSubmittedQuery("");
  };

  /**
   * デスクトップは Esc で検索をクリアする（home.md §7）。
   *
   * `TextInput` の `onKeyPress` は使えない。react-native-web はそれを DOM の
   * `keypress` に対応づけるが、**Escape のような非印字キーでは `keypress` が
   * 発火しない**（実ブラウザで計測して判明。`keydown` と `keyup` のみ来る）。
   * そこで web のときだけ DOM の `keydown` を直接購読する。
   * ネイティブには Esc キーが無いので、この購読自体を行わない。
   */
  const searchInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = searchInputRef.current as unknown as HTMLInputElement | null;
    if (!node?.addEventListener) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // setState 関数は再描画をまたいで同一なので、依存配列は空でよい。
      setInput("");
      setSubmittedQuery("");
    };
    node.addEventListener("keydown", handleKeyDown);
    return () => node.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* アプリバー（ロゴ） */}
      <View className="px-4 py-2">
        <Text testID="home-logo" className="text-xl font-bold text-orange-600">
          Recipi
        </Text>
      </View>

      {/* 常時固定の検索窓。本文をスクロールしても残るよう、リストの外に置く。 */}
      <View className="flex-row items-center gap-2 px-4 pb-2">
        <TextInput
          testID="home-search-input"
          value={input}
          onChangeText={handleChangeText}
          ref={searchInputRef}
          onSubmitEditing={submitSearch}
          placeholder="レシピ・材料で検索"
          returnKeyType="search"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
        />
        {input !== "" && (
          <Pressable
            testID="home-search-clear"
            onPress={clearSearch}
            accessibilityRole="button"
            accessibilityLabel="検索をクリア"
          >
            <Text className="px-1 text-lg text-neutral-500">×</Text>
          </Pressable>
        )}
        {/* 押して検索できる導線（home.md §5）。キーボードの確定キーだけに
            頼らないためのもの（`submitSearch` のコメント参照）。 */}
        <Pressable
          testID="home-search-submit"
          onPress={submitSearch}
          accessibilityRole="button"
          accessibilityLabel="検索"
          className="rounded-lg bg-orange-500 px-3 py-2"
        >
          <Text className="text-sm font-semibold text-white">検索</Text>
        </Pressable>
      </View>

      {/* サブタブ */}
      <View className="flex-row gap-1 border-b border-neutral-200 px-2">
        {SUB_TABS.map((tab) => {
          const focused = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              testID={`home-subtab-${tab.key}`}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              className={`px-3 py-2 ${focused ? "border-b-2 border-orange-500" : ""}`}
            >
              <Text
                className={`text-sm ${focused ? "font-semibold text-orange-600" : "text-neutral-500"}`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 検索語チップ（検索中のみ）。× で通常フィードに戻る。 */}
      {hasQuery && (
        <View className="flex-row px-4 pt-2">
          <Pressable
            testID="home-search-chip"
            onPress={clearSearch}
            accessibilityRole="button"
            className="flex-row items-center gap-1 rounded-full bg-neutral-100 px-3 py-1"
          >
            <Text className="text-sm text-neutral-700">{submittedQuery}</Text>
            <Text className="text-sm text-neutral-500">×</Text>
          </Pressable>
        </View>
      )}

      {!isReadyTab ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text testID="home-tab-not-ready" className="text-center text-neutral-500">
            この機能は準備中です
          </Text>
        </View>
      ) : feed.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : feed.isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-neutral-600">読み込みに失敗しました</Text>
          <Pressable
            testID="home-retry"
            onPress={() => void feed.refetch()}
            accessibilityRole="button"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          >
            <Text className="text-neutral-700">再試行</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="home-feed-list"
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerClassName="gap-2 p-4"
          renderItem={({ item }) => (
            <FeedRecipeCard
              testID={`feed-recipe-${item.id}`}
              recipe={item}
              onPress={() => router.push(`${basePath}/recipes/${item.id}` as never)}
            />
          )}
          ListEmptyComponent={
            <Text testID="home-feed-empty" className="mt-10 text-center text-neutral-500">
              {hasQuery
                ? `「${submittedQuery}」に一致するレシピは見つかりませんでした`
                : "まだレシピがありません"}
            </Text>
          }
          refreshControl={
            <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />
          }
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            feed.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null
          }
        />
      )}
    </View>
  );
}
