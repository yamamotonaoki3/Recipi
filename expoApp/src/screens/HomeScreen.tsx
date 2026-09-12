/**
 * ホーム（screens/home.md）。
 *
 * 上から「ロゴ → 常時固定の検索窓 → サブタブ → レシピカードの縦リスト」。
 * 機能するのは「全体」「フォロー」「フォロワー」＋ 検索（Issue #98 で
 * フォロー / フォロワーを有効化）。「お気に入りレシピ」は F4 まで「準備中」を出す。
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
import type { FeedKind } from "@/features/feed/api";
import { useFeed } from "@/features/feed/hooks";

/**
 * サブタブ（home-feed.md §2）。`feed` があるタブは一覧を取得し、
 * 無いタブ（お気に入りレシピ）は F4 まで「準備中」を出す。
 * `empty` は検索語が無いときの空状態の文言（home.md §4）。
 */
const SUB_TABS = [
  { key: "all", label: "全体", feed: "all", empty: "まだレシピがありません" },
  {
    key: "following",
    label: "フォロー",
    feed: "following",
    empty: "気になる投稿者をフォローすると、ここに新着レシピが並びます",
  },
  {
    key: "followers",
    label: "フォロワー",
    feed: "followers",
    empty: "フォロワーが増えると、その人のレシピがここに並びます",
  },
  { key: "favorites", label: "お気に入りレシピ", feed: null, empty: "" },
] as const satisfies readonly {
  key: string;
  label: string;
  feed: FeedKind | null;
  empty: string;
}[];

type SubTabKey = (typeof SUB_TABS)[number]["key"];

export function HomeScreen({ basePath }: { basePath: string }) {
  const insets = useSafeAreaInsets();

  // 検索窓の「入力中の文字」と「確定した検索語」は別物。
  // home.md §5 のとおり、確定（Enter / 検索キー）で初めて絞り込みが走る。
  const [input, setInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SubTabKey>("all");

  /**
   * 一度でも開いたサブタブ。開いたタブの一覧は、別のタブに切り替えても
   * **消さずに隠すだけ**にする。消すとスクロール位置が失われるため
   * （home.md §5「切替時にスクロール位置はサブタブごとに保持」）。
   * まだ開いていないタブは作らない（最初に開いたときに取得する）。
   */
  const [visitedTabs, setVisitedTabs] = useState<SubTabKey[]>(["all"]);

  const selectTab = (key: SubTabKey) => {
    setActiveTab(key);
    setVisitedTabs((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };

  const active = SUB_TABS.find((t) => t.key === activeTab) ?? SUB_TABS[0];
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
              onPress={() => selectTab(tab.key)}
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

      {/* 一度開いたタブの一覧は、隠すだけで残す（スクロール位置を保つため）。 */}
      {SUB_TABS.map((tab) =>
        tab.feed !== null && visitedTabs.includes(tab.key) ? (
          <FeedList
            key={tab.key}
            feed={tab.feed}
            query={submittedQuery}
            emptyText={tab.empty}
            visible={tab.key === activeTab}
            basePath={basePath}
          />
        ) : null,
      )}

      {active.feed === null && (
        <View className="flex-1 items-center justify-center p-6">
          <Text testID="home-tab-not-ready" className="text-center text-neutral-500">
            この機能は準備中です
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * 1 つのサブタブの一覧（loading / error / 空 / 無限スクロール / 引っぱって更新）。
 *
 * **隠れている間（`visible: false`）は取得しない**。検索語を変えても、
 * 取り直すのは表示中のタブだけ（隠れたタブは次に表示したときに取得する）。
 * 隠すのは `display: "none"` で、画面から消えるので押すこともできない。
 *
 * testID は「全体」タブだけ従来どおり（`home-feed-list` / `feed-recipe-{id}` 等）に
 * して、既存のテストと E2E をそのまま使えるようにする。他のタブはタブ名を入れる
 * （隠れた一覧と testID が重ならないように）。
 */
function FeedList({
  feed,
  query,
  emptyText,
  visible,
  basePath,
}: {
  feed: FeedKind;
  query: string;
  emptyText: string;
  visible: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const result = useFeed(feed, query, { enabled: visible });
  const items = result.data?.pages.flatMap((p) => p.items) ?? [];
  const suffix = feed === "all" ? "" : `-${feed}`;
  const cardPrefix = feed === "all" ? "feed-recipe" : `feed-${feed}-recipe`;

  return (
    <View className="flex-1" style={{ display: visible ? "flex" : "none" }}>
      {result.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : result.isError ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-neutral-600">読み込みに失敗しました</Text>
          <Pressable
            testID={`home-retry${suffix}`}
            onPress={() => void result.refetch()}
            accessibilityRole="button"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          >
            <Text className="text-neutral-700">再試行</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID={`home-feed-list${suffix}`}
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerClassName="gap-2 p-4"
          renderItem={({ item }) => (
            <FeedRecipeCard
              testID={`${cardPrefix}-${item.id}`}
              recipe={item}
              onPress={() => router.push(`${basePath}/recipes/${item.id}` as never)}
            />
          )}
          ListEmptyComponent={
            <Text
              testID={`home-feed-empty${suffix}`}
              className="mt-10 text-center text-neutral-500"
            >
              {query !== "" ? `「${query}」に一致するレシピは見つかりませんでした` : emptyText}
            </Text>
          }
          refreshControl={
            <RefreshControl
              refreshing={result.isRefetching}
              onRefresh={() => void result.refetch()}
            />
          }
          onEndReached={() => {
            if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            result.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null
          }
        />
      )}
    </View>
  );
}
