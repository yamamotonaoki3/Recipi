/**
 * メインシェル: 5 destination のナビゲーション（screens/navigation.md）。
 *
 * ## なぜ headless Tabs（`expo-router/ui`）なのか
 * 既定の見た目つきタブはバーが**画面下に固定**で、デスクトップ用の
 * 「画面左のナビゲーションレール」に置き換えられない。headless 版は
 * `<TabSlot />`（画面本体）と `<TabList />`（バー）を自分で並べられるので、
 * **コンテナの `flexDirection` を入れ替えるだけ**で下バー ⇔ 左レールを切り替えられる。
 * expo-router に同梱なので追加の依存も要らない。
 *
 * ## 並べ方
 * 子の順番は常に `[TabSlot, TabList]` に固定し、方向だけを変える:
 * - コンパクト幅: `column`      → 本体が上、バーが下（ボトムナビ）
 * - 中〜広幅:     `row-reverse` → バーが左、本体が右（ナビゲーションレール）
 * 子の順番を条件で入れ替えないのは、入れ替えると画面がアンマウントされて
 * スクロール位置などの状態が飛ぶため。
 *
 * ## 「＋」だけタブではない
 * `TabList` の中に置いた **TabTrigger 以外の要素は expo-router のタブ走査から
 * 無視される**。それを利用して「＋」を素の Pressable にしてあり、押すと
 * レシピ作成をモーダルで開くだけでタブは選択状態にならない
 * （navigation.md「タブ自体は選択状態にしない」）。
 */
import { usePathname, useRouter } from "expo-router";
import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { Pressable, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NavCreateButton, NavItemLabel, useIsNavRail } from "@/components/AppNavBar";
import { DESTINATIONS_WITH_RECIPE_STACK } from "@/features/navigation/destinations";
import { useUnsavedChangesStore } from "@/features/navigation/unsavedChanges";

/** タブの定義（並び順は navigation.md: ホーム / 履歴 / ＋ / 通知 / マイページ）。 */
const LEFT_TABS = [
  { name: "home", href: "/home", testID: "nav-home", icon: "🏠", label: "ホーム" },
  { name: "history", href: "/history", testID: "nav-history", icon: "🕘", label: "履歴" },
] as const;

const RIGHT_TABS = [
  {
    name: "notifications",
    href: "/notifications",
    testID: "nav-notifications",
    icon: "🔔",
    label: "通知",
  },
  { name: "my-page", href: "/my-page", testID: "nav-my-page", icon: "👤", label: "マイページ" },
] as const;

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isRail = useIsNavRail();

  /**
   * 既に選択中の destination をもう一度押したときに、そのタブのスタックを
   * 根まで戻す（navigation.md「既に選択中の destination をもう一度タップ →
   * そのタブのスタックをルートまで戻す」）。
   *
   * expo-router の `TabTrigger` は **選択中のタブを押しても何もしない**
   * （`useTabTrigger` が `if (!trigger.isFocused)` で切替を止める）。
   * そのため詳細を開いたまま「ホーム」を押しても詳細に留まってしまう
   * （Codex #42 レビュー指摘）。`TabTrigger` に渡した `onPress` は
   * 本体の処理より先に呼ばれるので、ここで自前に戻す。
   */
  const popToDestinationRoot = (href: string, event?: GestureResponderEvent) => {
    if (pathname !== href && pathname.startsWith(`${href}/`)) {
      const requestClose = useUnsavedChangesStore.getState().requestClose;
      if (requestClose) {
        // TabTrigger は onPress の後に tabPress を送り、スタックを戻してしまう。
        // 確認ダイアログを出す前に既定動作を止めないと、編集画面まで閉じてしまう。
        event?.preventDefault();
        requestClose();
        return;
      }
      router.dismissTo(href as never);
    }
  };

  /**
   * いま居る destination の根（`/home` など）。
   *
   * 「＋」で開いた作成モーダルは、保存後に**その destination のスタック**へ
   * 詳細を積みたい（履歴から作ってホームへ飛ばされない。Codex #42 指摘）。
   *
   * 対象は**レシピ詳細を積めるスタックを持つ destination だけ**。通知は MVP では
   * 空状態のスタブでネストしたスタックが無く、`/notifications/recipes/{id}` は
   * 存在しないルートになってしまうため、ホームに倒す（Codex #42 レビュー指摘）。
   */
  const currentDestination =
    DESTINATIONS_WITH_RECIPE_STACK.find(
      (href) => pathname === href || pathname.startsWith(`${href}/`),
    ) ?? "/home";

  // レール（左）のときは上端、ボトムバーのときは下端のセーフエリアを確保する。
  // 確保しないとステータスバー / ホームインジケータにバーが潜り込み、
  // Android では要素がアクセシビリティツリーから消えて E2E が落ちる（#57 / #58）。
  const barStyle = isRail
    ? { paddingTop: insets.top, paddingBottom: insets.bottom }
    : { paddingBottom: insets.bottom };

  return (
    <Tabs
      style={{ flex: 1, flexDirection: isRail ? "row-reverse" : "column" }}
      // タブのルートで戻ったときは**ホーム destination へ**戻す
      // （navigation.md「ルートで戻る → ホーム destination へ」）。
      // `history` にすると「直前に見ていたタブ」へ戻ってしまい仕様と食い違う
      // （ホーム → マイページ → 履歴 で戻るとマイページに行く。Codex #42 指摘）。
      // ホームは TabList の先頭なので `firstRoute` がそのままホームを指す。
      options={{ backBehavior: "firstRoute" }}
    >
      <TabSlot style={{ flex: 1 }} />
      <TabList
        testID="app-nav-bar"
        style={[
          {
            flexDirection: isRail ? "column" : "row",
            alignItems: "center",
            justifyContent: isRail ? "flex-start" : "space-around",
            gap: isRail ? 20 : 0,
            paddingVertical: isRail ? 16 : 8,
            paddingHorizontal: isRail ? 12 : 0,
            borderTopWidth: isRail ? 0 : 1,
            borderRightWidth: isRail ? 1 : 0,
            borderColor: "#e5e5e5",
            backgroundColor: "#ffffff",
          },
          barStyle,
        ]}
      >
        {LEFT_TABS.map((tab) => (
          <TabTrigger
            key={tab.name}
            name={tab.name}
            href={tab.href}
            testID={tab.testID}
            onPress={(event) => popToDestinationRoot(tab.href, event)}
            asChild
          >
            <NavTabButton icon={tab.icon} label={tab.label} />
          </TabTrigger>
        ))}

        {/* 「＋」はタブではない（上のファイルコメント参照）。 */}
        <NavCreateButton
          onPress={() =>
            router.push({
              pathname: "/(app)/recipes/new",
              params: { from: currentDestination },
            })
          }
        />

        {RIGHT_TABS.map((tab) => (
          <TabTrigger
            key={tab.name}
            name={tab.name}
            href={tab.href}
            testID={tab.testID}
            onPress={(event) => popToDestinationRoot(tab.href, event)}
            asChild
          >
            <NavTabButton icon={tab.icon} label={tab.label} />
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

/**
 * `TabTrigger asChild` に渡す中身。
 *
 * `asChild` を使うと TabTrigger は自分のラッパーを作らず、**Pressable 用の props**
 * （`onPress` 等）と `isFocused`（選択中か）をこの子に流し込む。
 * そのため受け取る側は必ず **`Pressable`** にする。`View` にすると `onPress` が
 * 無視され、Web ではアンカーの既定動作だけが残って**ページ全体がリロード**される
 * （＝クライアント側のタブ遷移にならず、セッションが飛ぶ）。実ブラウザで踏んだ。
 */
function NavTabButton({
  icon,
  label,
  isFocused,
  ...pressableProps
}: {
  icon: string;
  label: string;
  isFocused?: boolean;
} & React.ComponentProps<typeof Pressable>) {
  return (
    <Pressable {...pressableProps} className="min-w-16 items-center justify-center py-1">
      <NavItemLabel icon={icon} label={label} focused={Boolean(isFocused)} />
    </Pressable>
  );
}
