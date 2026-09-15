/**
 * アプリ共通のアイコン部品（Issue #144）。
 *
 * アイコンは lucide-react-native（線で描く SVG アイコン集）を使う。
 * 絵文字や記号の文字（🏠 ♡ ▼ など）は OS ごとに絵柄が変わり、線の太さも
 * そろわないため、Android / iOS / Web / Tauri で同じ見た目になる SVG に統一した。
 *
 * ここでは「大きさ・線の太さ・色の既定値」を 1 か所にまとめるだけにしている。
 * 使う側は `<Icon as={House} />` のように、lucide のアイコン部品を `as` で渡す。
 *
 * Lucide の `color` は NativeWind の className を受け取れないので、
 * Tailwind と同じ色の値を `ICON_COLORS` に定数で持つ。
 */
import type { LucideIcon } from "lucide-react-native";
import { Platform, View } from "react-native";

/** Tailwind の色クラスと同じ値（text-orange-600 などと見た目をそろえる）。 */
export const ICON_COLORS = {
  /** 選択中・強調（text-orange-600） */
  accent: "#ea580c",
  /** 通常（text-neutral-500） */
  muted: "#737373",
  /** 本文寄りの濃い灰色（text-neutral-700） */
  strong: "#404040",
  /** 押せない・控えめ（text-neutral-300） */
  disabled: "#d4d4d4",
  /** 補足情報（text-neutral-400） */
  subtle: "#a3a3a3",
  /** お気に入りのハート（text-red-500） */
  favorite: "#ef4444",
  /** 塗りつぶしボタンの上（text-white） */
  onAccent: "#ffffff",
} as const;

type IconProps = {
  /** 描くアイコン（lucide-react-native から import した部品）。 */
  as: LucideIcon;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** 塗りつぶす色（お気に入り済みのハートなど）。省略時は線だけ。 */
  fill?: string;
  testID?: string;
};

export function Icon({
  as: Component,
  size = 20,
  color = ICON_COLORS.muted,
  strokeWidth = 2,
  fill = "none",
  testID,
}: IconProps) {
  // Web では SVG が DOM 要素になるため、Native 専用の指定を渡すと React の警告になる。
  // Web は aria-hidden、Android / iOS は従来の Native 指定で、どちらも飾りとして隠す。
  const accessibilityProps =
    Platform.OS === "web"
      ? { "aria-hidden": true }
      : {
          accessibilityElementsHidden: true,
          importantForAccessibility: "no-hide-descendants" as const,
        };
  const icon = (
    <Component
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      fill={fill}
      // アイコンは飾り。読み上げは隣のラベルやボタンの accessibilityLabel に任せ、
      // スクリーンリーダーが「画像」を余計に読み上げないようにする。
      {...accessibilityProps}
    />
  );
  // lucide の SVG は testID を描画結果に渡さないため、テストで探せるよう
  // testID があるときだけ View で包む（包まない場合は余計な View を増やさない）。
  return testID ? <View testID={testID}>{icon}</View> : icon;
}
