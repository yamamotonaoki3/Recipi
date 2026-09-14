/**
 * ホームの検索語の事前チェックのテスト（features/search.md §6。Issue #134）。
 * backend（`split_search_terms`）と同じ「空白で分割 → 語数 → 各語の文字数」の順・規則。
 */
import { SEARCH_MAX_TERM_LENGTH, validateSearchQuery } from "../validateQuery";

describe("validateSearchQuery", () => {
  it("空の入力は問題なし（通常フィードに戻るだけ）", () => {
    expect(validateSearchQuery("")).toBeUndefined();
    expect(validateSearchQuery("   ")).toBeUndefined();
  });

  it("5 語までは問題なし、6 語で止める", () => {
    expect(validateSearchQuery("玉ねぎ 豚肉 にんじん じゃがいも 醤油")).toBeUndefined();
    expect(validateSearchQuery("玉ねぎ 豚肉 にんじん じゃがいも 醤油 砂糖")).toBe(
      "検索語は5語までにしてください",
    );
  });

  it("全角スペースや連続する空白も区切りとして数える（backend の str.split と同じ）", () => {
    expect(validateSearchQuery("あ　い　う　え　お　か")).toBe("検索語は5語までにしてください");
    expect(validateSearchQuery("  あ   い\tう  ")).toBeUndefined();
  });

  it("U+001F も区切りとして扱い、6 語で止める", () => {
    expect(validateSearchQuery("あ\u001Fい\u001Fう\u001Fえ\u001Fお\u001Fか")).toBe(
      "検索語は5語までにしてください",
    );
  });

  it("U+FEFF は区切りとして扱わない", () => {
    expect(validateSearchQuery("あ\uFEFFい\uFEFFう\uFEFFえ\uFEFFお\uFEFFか")).toBeUndefined();
  });

  it("1 語 30 文字までは問題なし、31 文字で止める", () => {
    expect(validateSearchQuery("あ".repeat(SEARCH_MAX_TERM_LENGTH))).toBeUndefined();
    expect(validateSearchQuery("あ".repeat(SEARCH_MAX_TERM_LENGTH + 1))).toBe(
      "検索語は1語あたり30文字までにしてください",
    );
  });

  it("絵文字を含む 30 文字は通る（コードポイントで数える）", () => {
    expect(validateSearchQuery(`${"あ".repeat(29)}😋`)).toBeUndefined();
  });

  it("語数を先に確かめる（6 語でどれかが長くても、語数の理由を出す）", () => {
    expect(validateSearchQuery(`a b c d e ${"あ".repeat(40)}`)).toBe(
      "検索語は5語までにしてください",
    );
  });
});
