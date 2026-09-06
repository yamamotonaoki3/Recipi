/**
 * formatQuantity の WB テスト（features/unit.md §3.1）。
 * placement(prefix/suffix) × quantity(null/非null) × unit(null/非null) を網羅する。
 */
import { formatQuantity } from "../formatQuantity";

describe("formatQuantity", () => {
  it("数量あり + suffix → '<数量> <単位>'", () => {
    expect(formatQuantity({ quantity: "200", unit: "g", placement: "suffix" })).toBe("200 g");
  });

  it("数量あり + prefix → '<単位> <数量>'", () => {
    expect(formatQuantity({ quantity: "2", unit: "大さじ", placement: "prefix" })).toBe("大さじ 2");
  });

  it("数量なし（quantity=null）→ '<単位>' のみ", () => {
    expect(formatQuantity({ quantity: null, unit: "少々", placement: "suffix" })).toBe("少々");
    expect(formatQuantity({ quantity: null, unit: "適量", placement: "prefix" })).toBe("適量");
  });

  it("単位なし（unit=null）+ 数量あり → '<数量>' のみ", () => {
    expect(formatQuantity({ quantity: "3", unit: null, placement: "suffix" })).toBe("3");
  });

  it("数量なし + 単位なし → 空文字", () => {
    expect(formatQuantity({ quantity: null, unit: null, placement: "suffix" })).toBe("");
    expect(formatQuantity({ quantity: "", unit: "", placement: "suffix" })).toBe("");
  });

  it("Decimal 文字列の余計な末尾ゼロを落とす", () => {
    expect(formatQuantity({ quantity: "200.000", unit: "g", placement: "suffix" })).toBe("200 g");
    expect(formatQuantity({ quantity: "1.50", unit: "カップ", placement: "suffix" })).toBe(
      "1.5 カップ",
    );
  });

  it("number でも文字列でも同じ結果", () => {
    expect(formatQuantity({ quantity: 200, unit: "g", placement: "suffix" })).toBe("200 g");
  });

  it("placement が未指定なら suffix 扱い", () => {
    expect(formatQuantity({ quantity: "2", unit: "個", placement: undefined })).toBe("2 個");
  });

  it("数として解釈できない数量はそのまま表示（将来の分数入力等の余地）", () => {
    expect(formatQuantity({ quantity: "1/2", unit: "本", placement: "suffix" })).toBe("1/2 本");
  });
});
