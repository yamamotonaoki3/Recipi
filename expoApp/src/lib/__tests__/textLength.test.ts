/**
 * 文字数の数え方のテスト（Issue #134）。backend の Python `len` と同じコードポイント単位。
 */
import { countChars } from "../textLength";

describe("countChars", () => {
  it("ふつうの文字は 1 文字ずつ数える", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("abc")).toBe(3);
    expect(countChars("肉じゃが")).toBe(4);
  });

  it("絵文字も 1 文字と数える（.length は 2 になる）", () => {
    const emoji = "😋";
    expect(emoji.length).toBe(2);
    expect(countChars(emoji)).toBe(1);
    expect(countChars("おいしい😋")).toBe(5);
  });

  it("結合文字はコードポイントごとに数える（Python の len と同じ）", () => {
    // 「が」を「か」＋濁点の 2 コードポイントで書いたもの。
    expect(countChars("が")).toBe(2);
  });
});
