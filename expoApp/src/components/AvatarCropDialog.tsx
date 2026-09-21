/**
 * アバターの切り抜きダイアログ（Issue #251）。
 *
 * 選んだ写真を正方形の窓に表示し、**ドラッグで位置、＋/－ボタンで拡大縮小**を決めてから確定する。
 * ドラッグは `PanResponder` なので指でもマウスでも動く（Android / Web 共通。新しい依存なし）。
 * 確定すると、窓に映っている範囲を元画像の画素で返す（`avatarCrop.ts`）。実際の切り抜きは
 * `pickImage` が `expo-image-manipulator` で行い、その範囲だけがサーバーへ送られる。
 * 窓の上に丸い枠を重ねて、アバターとして表示される範囲（円）を見せる。
 */
import { Image } from "expo-image";
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { Modal, PanResponder, Pressable, Text, View } from "react-native";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  centeredOffset,
  clampOffset,
  clampZoom,
  cropRect,
  rezoomOffset,
  type CropRect,
  type Offset,
} from "@/features/image/avatarCrop";
import type { PickedAsset } from "@/features/image/pickImage";

const VIEWPORT = 260;
const ZOOM_STEP = 0.25;

type Props = {
  asset: PickedAsset | null;
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
};

export function AvatarCropDialog({ asset, onConfirm, onCancel }: Props) {
  return (
    <Modal visible={asset !== null} transparent animationType="fade" onRequestClose={onCancel}>
      {asset && <CropBody asset={asset} onConfirm={onConfirm} onCancel={onCancel} />}
    </Modal>
  );
}

function CropBody({
  asset,
  onConfirm,
  onCancel,
}: {
  asset: PickedAsset;
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
}) {
  const { width, height } = asset;
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>(() => centeredOffset(width, height, VIEWPORT, 1));
  // ドラッグ中に最新の値を読むための控え。イベントハンドラの中だけで読み書きする。
  const latestRef = useRef({ zoom: MIN_ZOOM, offset, dragStart: offset });

  const applyOffset = useCallback((next: Offset) => {
    latestRef.current.offset = next;
    setOffset(next);
  }, []);

  const responder = useMemo(
    () =>
      // ハンドラは指を動かしている間にだけ呼ばれ、描画中に ref を読むことは無い（lint の誤検知）。
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          latestRef.current.dragStart = latestRef.current.offset;
        },
        onPanResponderMove: (_, g) => {
          const { dragStart, zoom: z } = latestRef.current;
          applyOffset(
            clampOffset(
              { x: dragStart.x + g.dx, y: dragStart.y + g.dy },
              width,
              height,
              VIEWPORT,
              z,
            ),
          );
        },
      }),
    [width, height, applyOffset],
  );

  const changeZoom = (delta: number) => {
    const next = clampZoom(zoom + delta);
    if (next === zoom) return;
    latestRef.current.zoom = next;
    applyOffset(rezoomOffset(offset, width, height, VIEWPORT, zoom, next));
    setZoom(next);
  };

  const scale = (VIEWPORT / Math.min(width, height)) * zoom;

  return (
    <View className="flex-1 items-center justify-center bg-black/60 px-6">
      <View className="items-center gap-4 rounded-2xl bg-white p-5" style={{ maxWidth: 360 }}>
        <Text className="text-base font-semibold text-neutral-900">アバターの表示範囲</Text>
        <Text className="text-center text-xs text-neutral-500">
          ドラッグで位置、＋/－で大きさを調整します。丸の内側が表示されます。
        </Text>

        <View
          testID="avatar-crop-viewport"
          {...responder.panHandlers}
          style={{ width: VIEWPORT, height: VIEWPORT, overflow: "hidden", backgroundColor: "#000" }}
        >
          <Image
            source={{ uri: asset.uri }}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: offset.x,
              top: offset.y,
              width: width * scale,
              height: height * scale,
            }}
            contentFit="fill"
          />
          {/* アバターとして見える円。外側を暗くはせず、輪郭だけを描く。 */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: VIEWPORT / 2,
              borderWidth: 2,
              borderColor: "#ffffff",
            }}
          />
        </View>

        <View className="flex-row items-center gap-4">
          <Pressable
            testID="avatar-crop-zoom-out"
            onPress={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            accessibilityRole="button"
            accessibilityLabel="縮小"
            className="h-10 w-10 items-center justify-center rounded-full border border-neutral-300"
          >
            <Text className="text-xl text-neutral-700">－</Text>
          </Pressable>
          <Text className="w-14 text-center text-sm text-neutral-600">{`${Math.round(zoom * 100)}%`}</Text>
          <Pressable
            testID="avatar-crop-zoom-in"
            onPress={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            accessibilityRole="button"
            accessibilityLabel="拡大"
            className="h-10 w-10 items-center justify-center rounded-full border border-neutral-300"
          >
            <Text className="text-xl text-neutral-700">＋</Text>
          </Pressable>
        </View>

        <View className="flex-row gap-3 self-stretch">
          <Pressable
            testID="avatar-crop-cancel"
            onPress={onCancel}
            accessibilityRole="button"
            className="flex-1 items-center rounded-lg border border-neutral-300 py-2"
          >
            <Text className="text-neutral-700">キャンセル</Text>
          </Pressable>
          <Pressable
            testID="avatar-crop-confirm"
            onPress={() => onConfirm(cropRect(offset, width, height, VIEWPORT, zoom))}
            accessibilityRole="button"
            className="flex-1 items-center rounded-lg bg-orange-500 py-2"
          >
            <Text className="font-semibold text-white">この範囲で設定</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * 「選んだ写真の切り抜き範囲を、ダイアログで決めてもらう」処理を Promise にする。
 * `chooseCrop` を `pickImage` に渡し、`dialog` を画面のどこかに置く。
 */
export function useAvatarCropper(): {
  chooseCrop: (asset: PickedAsset) => Promise<CropRect | null>;
  dialog: ReactElement;
} {
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const resolver = useRef<((rect: CropRect | null) => void) | null>(null);

  const chooseCrop = useCallback(
    (picked: PickedAsset) =>
      new Promise<CropRect | null>((resolve) => {
        resolver.current = resolve;
        setAsset(picked);
      }),
    [],
  );

  const settle = useCallback((rect: CropRect | null) => {
    resolver.current?.(rect);
    resolver.current = null;
    setAsset(null);
  }, []);

  const dialog = (
    <AvatarCropDialog
      asset={asset}
      onConfirm={(rect) => settle(rect)}
      onCancel={() => settle(null)}
    />
  );
  return { chooseCrop, dialog };
}
