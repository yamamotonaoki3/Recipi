import { isHorizontalSwipe, shiftIndex, swipeDirection } from "./tabSwipe";

describe("tabSwipe", () => {
  it("横がはっきり優勢なときだけスワイプとみなす（斜め・縦・小さな動きは除く）", () => {
    expect(isHorizontalSwipe(-80, 10)).toBe(true);
    expect(isHorizontalSwipe(-80, 60)).toBe(false); // 斜め
    expect(isHorizontalSwipe(5, 0)).toBe(false); // 小さい
    expect(isHorizontalSwipe(10, 100)).toBe(false); // 縦
  });

  it("左へ = 次、右へ = 前、距離が足りなければ切替なし", () => {
    expect(swipeDirection(-100, 5)).toBe(1);
    expect(swipeDirection(100, 5)).toBe(-1);
    expect(swipeDirection(-40, 0)).toBe(0);
    expect(swipeDirection(-100, 80)).toBe(0);
  });

  it("端では外側へ動かない", () => {
    expect(shiftIndex(0, -1, 4)).toBe(0);
    expect(shiftIndex(3, 1, 4)).toBe(3);
    expect(shiftIndex(1, 1, 4)).toBe(2);
    expect(shiftIndex(2, 0, 4)).toBe(2);
  });
});
