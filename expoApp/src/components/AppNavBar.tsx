/**
 * メインシェルのナビゲーション部品（screens/navigation.md）。
 *
 * ここには「見た目と幅の判定」だけを置く。`TabList` / `TabTrigger` 自体は
 * `app/(app)/_layout.tsx` に**直接**書く必要がある: expo-router の headless Tabs は
 * 子要素を走査して「どの TabTrigger がタブなのか」を決めており、その走査は
 * Fragment と TabList の中しか降りていかない。自作コンポーネントで TabTrigger を
 * 包むと、タブとして認識されなくなる。
 */
import { Pressable, Text, useWindowDimensions, View } from "react-native";

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
  icon: string;
  label: string;
  focused: boolean;
};

/** タブ 1 つ分の中身（アイコン ＋ ラベル）。選択中はオレンジで示す。 */
export function NavItemLabel({ icon, label, focused }: NavItemLabelProps) {
  const color = focused ? "text-orange-600" : "text-neutral-500";
  return (
    <View className="items-center gap-0.5">
      <Text className={`text-lg ${color}`}>{icon}</Text>
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
      <Text className="text-2xl leading-7 text-white">＋</Text>
    </Pressable>
  );
}
