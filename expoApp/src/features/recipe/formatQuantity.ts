/**
 * 材料の「数量 + 単位」を表示用の文字列に整形する純粋関数。
 *
 * features/unit.md §3.1 の表を実装する。**整形は表示上の関心なのでクライアント
 * 側で行う**（API は `quantity` / `unit` / `placement` を別々に返し、
 * 事前整形した文字列は返さない）。
 *
 * | 条件 | 表示 | 例 |
 * | --- | --- | --- |
 * | 数量あり + placement="suffix"（既定） | `<数量> <単位>` | `200 g` |
 * | 数量あり + placement="prefix"           | `<単位> <数量>` | `大さじ 2` |
 * | 数量なし（quantity が null）            | `<単位>` のみ   | `少々` |
 * | 単位なし（unit が null）+ 数量あり      | `<数量>` のみ   | `3` |
 */

export type Placement = "prefix" | "suffix";

export type FormatQuantityInput = {
  // API 上は Decimal が文字列で来る（"200" / "1.5"）。数値やコンポーネント状態
  // からの入力も受けられるよう number も許容する。
  quantity: string | number | null | undefined;
  unit: string | null | undefined;
  placement: Placement | null | undefined;
};

/**
 * 数量文字列を表示用に整える。
 * - 前後の空白を除去
 * - 数として解釈できるなら余計な末尾ゼロを落とす（"200.000" → "200"、"1.50" → "1.5"）
 * - 数として解釈できない（分数入力など将来の余地）ならそのまま返す
 */
export function normalizeQuantityText(raw: string | number): string {
  const text = String(raw).trim();
  if (text === "") return "";
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  // Number(...).toString() は "200.000" → "200"、"1.50" → "1.5" にしてくれる。
  return num.toString();
}

export function formatQuantity({ quantity, unit, placement }: FormatQuantityInput): string {
  const unitText = (unit ?? "").trim();
  const hasQuantity = quantity !== null && quantity !== undefined && String(quantity).trim() !== "";
  const quantityText = hasQuantity ? normalizeQuantityText(quantity as string | number) : "";

  // 単位なし: 数量だけ（数量も無ければ空文字）
  if (unitText === "") return quantityText;

  // 数量なし: 単位だけ（"少々" / "適量"）
  if (quantityText === "") return unitText;

  // 数量あり + 単位あり: placement で前後を決める（既定は suffix）
  return placement === "prefix" ? `${unitText} ${quantityText}` : `${quantityText} ${unitText}`;
}
