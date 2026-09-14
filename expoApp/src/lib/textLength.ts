/**
 * 文字数を数える（Issue #134）。
 *
 * backend（Python）は `len(文字列)` で数え、これは **Unicode のコードポイント** 単位になる
 * （絵文字も 1 文字）。一方 JavaScript の `.length` は UTF-16 の単位で数えるため、絵文字などを
 * 2 と数えてしまう。上限ちょうどの入力に絵文字が入ると、サーバーは受け付けるのに画面側だけで
 * 「長すぎる」と止まる食い違いが起きる（Issue #102 の感想で踏んだ）。
 *
 * 画面側で文字数を数えるときは、backend と同じ数え方になるこの関数を使う。
 */
export function countChars(value: string): number {
  return Array.from(value).length;
}
