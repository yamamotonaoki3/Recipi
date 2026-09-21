import {
  baseScale,
  centeredOffset,
  clampOffset,
  clampZoom,
  cropRect,
  rezoomOffset,
} from "./avatarCrop";

const V = 200;

describe("avatarCrop", () => {
  it("短辺が窓に収まる倍率になる", () => {
    expect(baseScale(400, 800, V)).toBe(0.5);
    expect(baseScale(800, 400, V)).toBe(0.5);
  });

  it("拡大率は 1〜4 に収める", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(2)).toBe(2);
  });

  it("縦長の写真は最初は中央を切り抜く（正方形・整数・画像内）", () => {
    const off = centeredOffset(400, 800, V, 1);
    expect(off).toEqual({ x: 0, y: -100 });
    expect(cropRect(off, 400, 800, V, 1)).toEqual({
      originX: 0,
      originY: 200,
      width: 400,
      height: 400,
    });
  });

  it("横長の写真も同様に中央を切り抜く", () => {
    const off = centeredOffset(800, 400, V, 1);
    expect(cropRect(off, 800, 400, V, 1)).toEqual({
      originX: 200,
      originY: 0,
      width: 400,
      height: 400,
    });
  });

  it("動かしすぎても窓が画像から外れない", () => {
    expect(clampOffset({ x: 50, y: 50 }, 400, 800, V, 1)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -999, y: -999 }, 400, 800, V, 1)).toEqual({ x: 0, y: -200 });
  });

  it("拡大すると切り抜く範囲が狭くなり、中央の点は動かない", () => {
    const off1 = centeredOffset(400, 800, V, 1);
    const off2 = rezoomOffset(off1, 400, 800, V, 1, 2);
    const rect = cropRect(off2, 400, 800, V, 2);
    expect(rect.width).toBe(200);
    expect(rect.originX + rect.width / 2).toBe(200); // 元の中央 x
    expect(rect.originY + rect.height / 2).toBe(400); // 元の中央 y
  });

  it("画像が小さくても範囲は画像内に収まる", () => {
    const rect = cropRect({ x: 0, y: 0 }, 100, 100, V, 1);
    expect(rect).toEqual({ originX: 0, originY: 0, width: 100, height: 100 });
  });
});
