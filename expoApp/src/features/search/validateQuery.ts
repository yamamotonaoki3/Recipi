/**
 * ホームの検索語を、送る前に backend と同じ規則で確かめる（features/search.md §6。Issue #134）。
 *
 * backend は「5 語まで・1 語 30 文字まで」で、超えると 400 を返す。そのまま送ると
 * ホームの一覧が「読み込みに失敗しました」になり、何が悪いのか分からない。そこで送る前に
 * 同じ規則で止め、理由を検索窓の下に出す。
 *
 * 規則は backend（`app/text_normalize.split_search_terms`）とそろえる。
 * - 分割: 半角・全角・連続する空白をすべて区切りにする（backend の `str.split()` と同じ。
 *   空白の集合は下の PYTHON_WHITESPACE を参照）
 * - 語数を先に見て、次に各語の文字数を見る（正規化する前の文字数。コードポイントで数える）
 */
import { countChars } from "@/lib/textLength";

/** 検索語の上限（features/search.md §6 と同じ値）。 */
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_MAX_TERM_LENGTH = 30;

// JavaScript の `\s` は Python の `str.isspace()` と集合が異なり、U+001C〜U+001F
// と U+0085 を含まない一方で U+FEFF を含むため、backend の str.split() と結果がずれる。
// Python が空白と判定する文字だけを明示し、端の除去と語の分割で同じ正規表現を使う。
const PYTHON_WHITESPACE =
  /[\t\n\v\f\r\x1C-\x1F \x85\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/gu;

/** 問題なければ undefined、問題があれば画面に出す文言を返す。空の入力は問題なし（通常フィード）。 */
export function validateSearchQuery(input: string): string | undefined {
  // 空白で分けて空の要素を捨てる。前後の空白・連続する空白を無視する点も
  // Python の str.split()（引数なし）と同じ結果になる。
  const terms = input.split(PYTHON_WHITESPACE).filter((term) => term !== "");
  if (terms.length === 0) return undefined;

  if (terms.length > SEARCH_MAX_TERMS) {
    return `検索語は${SEARCH_MAX_TERMS}語までにしてください`;
  }
  if (terms.some((term) => countChars(term) > SEARCH_MAX_TERM_LENGTH)) {
    return `検索語は1語あたり${SEARCH_MAX_TERM_LENGTH}文字までにしてください`;
  }
  return undefined;
}
