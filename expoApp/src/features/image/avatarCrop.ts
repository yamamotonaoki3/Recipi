/**
 * アバターの切り抜き範囲の計算（Issue #251）。画面に依存しない純粋関数。
 *
 * 正方形の窓（viewport、1 辺 `viewport` px）の中で、画像を動かして拡大し、
 * 窓に映っている範囲を元画像の画素の正方形（`CropRect`）として返す。
 *
 * 座標の約束: `offset` は「窓の左上から見た、表示中の画像の左上」。画像が窓を
 * 覆っている間は常に 0 以下（右や下へ動かすと余白が見えてしまうので止める）。
 */

export type CropRect = { originX: number; originY: number; width: number; height: number };
export type Offset = { x: number; y: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** 拡大率 1 のときの倍率。短辺がちょうど窓に収まる（窓が必ず画像で覆われる）。 */
export function baseScale(imageWidth: number, imageHeight: number, viewport: number): number {
  return viewport / Math.min(imageWidth, imageHeight);
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

/** 窓が画像から外れないように offset を丸める。 */
export function clampOffset(
  offset: Offset,
  imageWidth: number,
  imageHeight: number,
  viewport: number,
  zoom: number,
): Offset {
  const scale = baseScale(imageWidth, imageHeight, viewport) * zoom;
  const minX = Math.min(viewport - imageWidth * scale, 0);
  const minY = Math.min(viewport - imageHeight * scale, 0);
  return {
    x: Math.min(Math.max(offset.x, minX), 0),
    y: Math.min(Math.max(offset.y, minY), 0),
  };
}

/** 窓の中央に画像の中央が来る offset（最初の位置）。 */
export function centeredOffset(
  imageWidth: number,
  imageHeight: number,
  viewport: number,
  zoom: number,
): Offset {
  const scale = baseScale(imageWidth, imageHeight, viewport) * zoom;
  return clampOffset(
    { x: (viewport - imageWidth * scale) / 2, y: (viewport - imageHeight * scale) / 2 },
    imageWidth,
    imageHeight,
    viewport,
    zoom,
  );
}

/**
 * 拡大率を変えたとき、窓の中央に見えている点が動かないように offset を計算し直す。
 */
export function rezoomOffset(
  offset: Offset,
  imageWidth: number,
  imageHeight: number,
  viewport: number,
  fromZoom: number,
  toZoom: number,
): Offset {
  const base = baseScale(imageWidth, imageHeight, viewport);
  const center = viewport / 2;
  // 窓の中央にある元画像の画素座標。
  const px = (center - offset.x) / (base * fromZoom);
  const py = (center - offset.y) / (base * fromZoom);
  return clampOffset(
    { x: center - px * base * toZoom, y: center - py * base * toZoom },
    imageWidth,
    imageHeight,
    viewport,
    toZoom,
  );
}

/** 窓に映っている範囲を、元画像の画素の正方形にする（整数・画像内に収める）。 */
export function cropRect(
  offset: Offset,
  imageWidth: number,
  imageHeight: number,
  viewport: number,
  zoom: number,
): CropRect {
  const scale = baseScale(imageWidth, imageHeight, viewport) * zoom;
  const size = Math.min(Math.round(viewport / scale), imageWidth, imageHeight);
  const originX = Math.min(Math.max(Math.round(-offset.x / scale), 0), imageWidth - size);
  const originY = Math.min(Math.max(Math.round(-offset.y / scale), 0), imageHeight - size);
  return { originX, originY, width: size, height: size };
}
