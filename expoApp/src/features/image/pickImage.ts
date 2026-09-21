/**
 * 画像を選ぶ（ギャラリー / 撮影）→ 縮小する → アップロードできる形にする。
 * Issue #40。
 *
 * このファイルが **ネイティブと web の違いを吸収する唯一の場所**。
 * 呼び出し側（`useImageUpload` / `ImagePickerField`）はプラットフォームを
 * 意識しなくてよい。
 */
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import type { UploadFile } from "./api";
import type { CropRect } from "./avatarCrop";

/**
 * 公開設定APIを取得できない場合に使う、送信前の縮小長辺（px）。通常は
 * サーバーの `IMAGE_MAX_DIMENSION` を公開設定APIから取得してそろえる
 * （ずれると、送った画像がサーバーで再度縮小されて無駄な劣化が起きる）。
 *
 * これは「画質のため」ではなく **アップロードを成功させるため**の処理。
 * スマホの標準カメラは 4:3・約 4000x3000（12MP）で撮り、JPEG なら 1 枚
 * 2〜5MB になる。サーバーの受け入れ上限（5MB）を超えると 400 で弾かれ、
 * 利用者からは「なぜか画像が上げられない」としか見えない。
 * 送る前に 2048x1536 程度へ縮めておけば失敗しなくなり、通信量も減る。
 */
export const DEFAULT_IMAGE_MAX_DIMENSION = 2048;

/** JPEG の圧縮率（0〜1、1 が最高画質）。料理写真なので画質寄りにしておく。 */
const COMPRESS = 0.8;

export type PickSource = "library" | "camera";

/** 選択された画像。`uri` はプレビュー表示に、`file` はアップロードに使う。 */
export type PickedImage = {
  uri: string;
  file: UploadFile;
};

/** 利用者がキャンセルしたことを表す。エラーではないので例外にしない。 */
export type PickResult = PickedImage | null;

/**
 * 指定された上限へ縮小するための操作を返す。上限以下の画像は拡大しない。
 * 画像の向きに応じて長辺だけを指定することで、短辺は縦横比を保って計算される。
 */
export function imageResizeAction(
  width: number,
  height: number,
  maxDimension: number,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= maxDimension) return null;
  return width >= height ? { width: maxDimension } : { height: maxDimension };
}

/**
 * 権限を要求する。拒否されたら理由付きで例外を投げる。
 *
 * web ではライブラリ / カメラの権限 API が無く、ファイル選択ダイアログが
 * ブラウザの権限管理に任される。`expo-image-picker` の web 実装は常に
 * 許可済みを返すので、分岐を書かずそのまま呼んでよい。
 */
async function ensurePermission(source: PickSource): Promise<void> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error(
      source === "camera"
        ? "カメラの使用が許可されていません。端末の設定から許可してください。"
        : "写真へのアクセスが許可されていません。端末の設定から許可してください。",
    );
  }
}

/**
 * 縮小して JPEG で保存し直す。
 *
 * 長辺が上限以下ならそのまま返す（拡大はしない）。`resize` に `width` だけ
 * 渡すと高さは比率を保って自動計算されるので、長辺がどちらかで指定を変える。
 */
async function shrink(
  uri: string,
  width: number,
  height: number,
  maxDimension: number,
): Promise<string> {
  const resizeAction = imageResizeAction(width, height, maxDimension);
  if (!resizeAction) return uri;

  const context = ImageManipulator.manipulate(uri).resize(resizeAction);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  try {
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: COMPRESS });
    return saved.uri;
  } finally {
    // context と rendered はネイティブ画像資源を持つ SharedObject なので、GC 任せに
    // すると手順画像を何枚も選んだときに資源が残り続ける。保存の成否にかかわらず
    // ここで解放して、例外時にもネイティブ側のメモリを保持しないようにする。
    rendered?.release();
    context.release();
  }
}

/**
 * ローカルの URI を `FormData` に載せられる形に変換する。
 *
 * **ここがネイティブと web の最大の違い。**
 *
 * - ネイティブ（iOS / Android）: React Native の `FormData` は
 *   `{ uri, name, type }` という独自の形を受け付け、送信時にネイティブの
 *   ネットワーク層がそのファイルを直接読んでストリームに流す。ファイルの
 *   中身を JS 側のメモリに載せないので、大きな画像でも軽い。
 *   TypeScript の `FormData.append` は `Blob | string` しか受け付けないため、
 *   キャストが必要になる（RN の実装が独自拡張しているため）。
 * - web: 標準の `FormData` なので `{ uri }` は通らない。`uri`（`blob:` や
 *   `data:` の URL）を `fetch` して実体の `Blob` を取り出し、`File` にする。
 */
async function toUploadFile(uri: string): Promise<UploadFile> {
  if (Platform.OS === "web") {
    const blob = await fetch(uri).then((res) => res.blob());
    return new File([blob], "upload.jpg", { type: blob.type || "image/jpeg" });
  }

  return {
    uri,
    name: "upload.jpg",
    type: "image/jpeg",
  } as unknown as UploadFile;
}

/** 選んだ直後の元画像。切り抜き UI がこれを見て範囲を決める。 */
export type PickedAsset = { uri: string; width: number; height: number };

export type PickImageOptions = {
  /**
   * 指定すると、選んだあとに**切り抜く範囲を利用者に決めさせる**（アバター用。Issue #251）。
   * `null` を返したら取り消し（何も送らない）。範囲は元画像の画素で返す。
   */
  chooseCrop?: (asset: PickedAsset) => Promise<CropRect | null>;
};

/** 範囲を切り抜いて JPEG で保存し、上限まで縮小する。切り抜いた範囲だけが送られる。 */
async function cropAndShrink(uri: string, rect: CropRect, maxDimension: number): Promise<string> {
  const context = ImageManipulator.manipulate(uri).crop(rect);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  try {
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: COMPRESS });
    return shrink(saved.uri, saved.width, saved.height, maxDimension);
  } finally {
    rendered?.release();
    context.release();
  }
}

/**
 * 画像を 1 枚選び、縮小して返す。キャンセルされたら `null`。
 *
 * `mediaTypes: ["images"]` で動画を除外する（レシピに動画は無い）。
 * `quality: 1` にしているのは、ここでは劣化させず `shrink()` で
 * サイズを揃えてから 1 回だけ圧縮するため（二重圧縮を避ける）。
 */
export async function pickImage(
  source: PickSource = "library",
  maxDimension: number = DEFAULT_IMAGE_MAX_DIMENSION,
  cropOptions: PickImageOptions = {},
): Promise<PickResult> {
  await ensurePermission(source);

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
  };

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) return null;

  if (cropOptions.chooseCrop) {
    const rect = await cropOptions.chooseCrop({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
    });
    if (!rect) return null;
    const cropped = await cropAndShrink(asset.uri, rect, maxDimension);
    return { uri: cropped, file: await toUploadFile(cropped) };
  }

  const uri = await shrink(asset.uri, asset.width, asset.height, maxDimension);
  return { uri, file: await toUploadFile(uri) };
}
