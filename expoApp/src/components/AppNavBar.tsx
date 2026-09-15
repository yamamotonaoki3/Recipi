/**
 * メインシェルのナビゲーション部品（screens/navigation.md）。
 *
 * ここには「見た目と幅の判定」だけを置く。`TabList` / `TabTrigger` 自体は
 * `app/(app)/_layout.tsx` に**直接**書く必要がある: expo-router の headless Tabs は
 * 子要素を走査して「どの TabTrigger がタブなのか」を決めており、その走査は
 * Fragment と TabList の中しか降りていかない。自作コンポーネントで TabTrigger を
 * 包むと、タブとして認識されなくなる。
 */
import { Plus, type LucideIcon } from "lucide-react-native";
import { Pressable, Text, useWindowDimensions, View } from "react-native";

import { Icon, ICON_COLORS } from "@/components/Icon";

/**
 * ボトムナビ ⇔ ナビゲーションレールの切替幅（px）。
 *
 * navigation.md の「compact = ボトムバー、medium / expanded = レール」は
 * Material 3 の Window size class の用語で、compact の上限が 600dp。
 * それに合わせて 600 を境界にする（todo.md #26 の確定値）。
 * テストから同じ値を参照できるように定数として公開する。
 */
export const NAV_RAIL_MIN_WIDTH = 600;

/**
 * いまナビゲーションレール（画面左の縦並び）で出すべきかを返す。
 *
 * `useWindowDimensions()` はウィンドウのリサイズに追従するので、
 * デスクトップ（Tauri）で幅を変えるとその場で切り替わる。
 */
export function useIsNavRail(): boolean {
  const { width } = useWindowDimensions();
  return width >= NAV_RAIL_MIN_WIDTH;
}

type NavItemLabelProps = {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  badge?: number;
  /** アイコンの testID（テストで「どのアイコンを出したか」を確かめる用）。 */
  iconTestID?: string;
};

/**
 * タブ 1 つ分の中身（アイコン ＋ ラベル）。
 * 選択中はオレンジで線を太く、それ以外は灰色の細い線にして見分けやすくする。
 */
export function NavItemLabel({ icon, label, focused, badge = 0, iconTestID }: NavItemLabelProps) {
  const color = focused ? "text-orange-600" : "text-neutral-500";
  return (
    <View
      className="items-center gap-0.5"
      accessibilityLabel={badge > 0 ? `${label}、未読${badge}件` : label}
    >
      <View>
        <Icon
          as={icon}
          size={22}
          color={focused ? ICON_COLORS.accent : ICON_COLORS.muted}
          strokeWidth={focused ? 2.5 : 2}
          testID={iconTestID}
        />
        {badge > 0 && (
          <View
            testID="nav-notifications-badge"
            className="absolute -right-4 -top-2 min-w-5 items-center rounded-full bg-red-600 px-1"
          >
            <Text className="text-[10px] font-bold text-white">{badge > 99 ? "99+" : badge}</Text>
          </View>
        )}
      </View>
      <Text className={`text-[10px] ${color}`}>{label}</Text>
    </View>
  );
}

type NavCreateButtonProps = {
  onPress: () => void;
};

/**
 * 中央の「＋」。
 *
 * これは**タブではない**（navigation.md「タブ自体は選択状態にしない」）。
 * 押すとレシピ作成をモーダルで開き、閉じると直前の destination に戻る。
 * `TabList` の中に置いても、TabTrigger ではないので expo-router の
 * タブ走査からは無視される（＝ルートが増えない）。
 */
export function NavCreateButton({ onPress }: NavCreateButtonProps) {
  return (
    <Pressable
      testID="nav-create"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="レシピを作成"
      className="h-12 w-12 items-center justify-center rounded-full bg-orange-500"
    >
      <Icon as={Plus} size={26} color={ICON_COLORS.onAccent} strokeWidth={2.5} />
    </Pressable>
  );
}
