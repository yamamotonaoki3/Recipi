/**
 * ホームのサブタブの横スワイプ判定（Issue #250。home.md「モバイル: サブタブはスワイプでも切替」）。
 *
 * 縦スクロールする一覧（FlatList）と競合しないよう、**横方向がはっきり優勢なときだけ**
 * スワイプとして扱う。斜めの動きは縦スクロールに任せる。
 */

/** 動き始めをスワイプとみなす最小の横移動（px）。これ未満はタップ・縦スクロールの揺れ。 */
export const SWIPE_START_DISTANCE = 16;
/** 指を離したときに切替とみなす最小の横移動（px）。 */
export const SWIPE_COMMIT_DISTANCE = 60;
/** 横移動が縦移動の何倍以上ならスワイプとみなすか。 */
export const SWIPE_DOMINANCE = 2;

/** 動いている最中に、この動きを横スワイプとして奪ってよいか。 */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_START_DISTANCE && Math.abs(dx) >= Math.abs(dy) * SWIPE_DOMINANCE;
}

/** 指を離したときの切替方向。左へスワイプ = 次のタブ(+1)、右へ = 前のタブ(-1)、切替なし = 0。 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (!isHorizontalSwipe(dx, dy) || Math.abs(dx) < SWIPE_COMMIT_DISTANCE) return 0;
  return dx < 0 ? 1 : -1;
}

/** 現在の位置から方向へ動いた先の添字。端では動かず（外側へは何もしない）現在位置を返す。 */
export function shiftIndex(current: number, direction: -1 | 0 | 1, length: number): number {
  return Math.min(Math.max(current + direction, 0), length - 1);
}
