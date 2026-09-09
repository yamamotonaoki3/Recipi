/**
 * 画像を 1 枚選んで差し替え / 削除する入力欄（Issue #40）。
 * サムネイルと手順画像の両方で使う。
 *
 * ## 状態ごとの見た目
 *
 * | 状態 | プレビュー欄 | ボタン |
 * | --- | --- | --- |
 * | 画像なし | プレースホルダ | 押せる |
 * | 画像あり | **選んだ画像そのもの** ＋「削除」 | 押せる |
 * | **選択中** | 今の見た目のまま ＋ 案内文 | 変更は押せる、削除は押せない |
 * | アップロード中 | スピナー | 押せない |
 * | 失敗 | エラーメッセージ ＋ 直前の見た目のまま | 押せる |
 *
 * **選択中も画像変更ボタンは無効化しない**のが重要。端末のギャラリーやファイル選択
 * 画面が開いている間は通信していないので「アップロード中」ではないし、
 * 選択画面が開かない・戻ってこない環境でも、もう一度押せば選び直せるため。
 * 一方、削除ボタンだけは無効にする。選択結果があとから返ったときに、削除した画像が
 * 復活する競合を作らないため（理由の詳細は useImageUpload.ts のコメント）。
 *
 * ## アップロード直後に画像が出る仕組み
 *
 * `POST /images` は `key` と一緒に**表示用 URL** を返す（`ImageUploadResponse`
 * の定義に「アップロード直後のプレビュー表示に使う」と明記されている）。
 * 公開 URL のベースはサーバー側の設定なのでクライアントでは組み立てられず、
 * この URL を使わないと「選んだのに画像が出ない」状態になる。
 * そのため `onChange` は key と url を**セットで**返す。
 *
 * ## このコンポーネントが持たないもの
 *
 * 「今のキーは何か」は**持たない**（props で受け取るだけ）。キーはレシピ
 * フォームの状態の一部で、保存されるまで生き続ける値だから。ここが持つのは
 * 「今アップロード中か」「確認メッセージを出しているか」という一時的な状態だけ。
 */
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";

import { useImageUpload } from "@/features/image/useImageUpload";
import type { PickSource } from "@/features/image/pickImage";

type Variant = "thumbnail" | "step";

type ImagePickerFieldProps = {
  /** 現在のオブジェクトキー。null = 画像なし。 */
  imageKey: string | null;
  /** 表示用 URL。null = 画像なし。 */
  imageUrl?: string | null;
  /** 画像が変わったとき（選択・削除）に呼ばれる。削除は両方 null。 */
  onChange: (key: string | null, url: string | null) => void;
  /** サムネイル（大きく表示）か手順画像（小さく表示）か。 */
  variant?: Variant;
  testID: string;
  label?: string;
  /** 選択中・アップロード中のどちらでも、親に「保存を待つべき」と知らせる。 */
  onUploadingChange?: (uploading: boolean) => void;
};

/**
 * バリアントごとの見た目の違いをここにまとめる（分岐を JSX に散らさない）。
 *
 * **高さではなく `aspectRatio` で枠を決める**のが要点。スマホの標準カメラは
 * どの機種も 4:3 で撮るのに、高さを固定すると幅の広い画面ほど枠が横長になり、
 * 写真の上下が大きく切り落とされる（デスクトップ幅では帯状になっていた）。
 * 4:3 にそろえておけば、横向き写真はほぼ全体が入り、レシピごとに高さが
 * ばらつかないので一覧の見た目も揃う。
 */
const ASPECT_RATIO = 4 / 3;

const STYLES = {
  thumbnail: { radius: 12, placeholder: "レシピの写真を追加" },
  step: { radius: 8, placeholder: "手順の画像を追加" },
} as const;

/** 「設定しました」のポップアップを出しておく時間（ミリ秒）。 */
const TOAST_MS = 2000;

export function ImagePickerField({
  imageKey,
  imageUrl,
  onChange,
  variant = "thumbnail",
  testID,
  label,
  onUploadingChange,
}: ImagePickerFieldProps) {
  const upload = useImageUpload();
  const style = STYLES[variant];
  const isUploading = upload.status === "uploading";
  const isPicking = upload.status === "picking";
  const isBusy = isPicking || isUploading;
  const hasImage = imageKey !== null && Boolean(imageUrl);

  useEffect(() => {
    // 選択画面を開いている間もフォームにはまだ新しいキーが入っていない。
    // この通知を親が保存ボタンの無効化に使うことで、画像なしで保存されるのを防ぐ。
    onUploadingChange?.(isBusy);
    return () => {
      // 手順行を削除するとこの入力欄もアンマウントされる。親に完了を通知しないと、
      // 既に存在しない画像を数え続けて保存ボタンが永久に無効になるため片付ける。
      if (isBusy) onUploadingChange?.(false);
    };
  }, [isBusy, onUploadingChange]);

  // 設定完了のポップアップ。一定時間で自動的に消す
  //（画像そのものが表示されるので、操作を止めてまで確認させる必要はない）。
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), TOAST_MS);
  }

  async function handlePick(source: PickSource = "library") {
    const uploaded = await upload.pickAndUpload(source);
    // キャンセル・失敗のときは null が返る。既存の画像を消してしまわないよう、
    // 成功したときだけ差し替える（失敗メッセージは upload.error に入る）。
    if (!uploaded) return;
    onChange(uploaded.key, uploaded.url);
    showToast();
  }

  function handleRemove() {
    // 選択画面の古い結果があとから返ると、削除した画像が復活する可能性がある。
    // 進行中はボタン自体も無効にするが、イベントが別経路から届いても削除しない。
    if (isBusy) return;
    upload.clearError();
    setToastVisible(false);
    onChange(null, null);
  }

  return (
    <View className="gap-1">
      {label && <Text className="mb-1 text-xs text-neutral-500">{label}</Text>}

      <View
        testID={testID}
        className="w-full items-center justify-center overflow-hidden bg-neutral-100"
        style={{ aspectRatio: ASPECT_RATIO, borderRadius: style.radius }}
      >
        {isUploading ? (
          <View className="items-center gap-2">
            <ActivityIndicator testID={`${testID}-spinner`} />
            <Text className="text-xs text-neutral-500">アップロード中…</Text>
          </View>
        ) : hasImage ? (
          // 一覧カードや詳細画面は見た目をそろえるため cover で切り抜くが、
          // ここは編集画面で「どの写真を選んだか」を確認する場所なので、
          // 縦向き写真も含めて画像全体を見せる contain にする。
          <Image
            testID={`${testID}-preview`}
            source={{ uri: imageUrl as string }}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
          />
        ) : (
          <Text testID={`${testID}-placeholder`} className="text-sm text-neutral-400">
            {style.placeholder}
          </Text>
        )}

        {/* 設定完了のポップアップ。プレビューに重ねて出し、自動で消える。
            画像の表示を隠さないよう下端に寄せる。 */}
        {toastVisible && (
          <View
            testID={`${testID}-toast`}
            pointerEvents="none"
            className="absolute bottom-2 rounded-full bg-neutral-900/80 px-3 py-1.5"
          >
            <Text className="text-xs text-white">画像を設定しました</Text>
          </View>
        )}
      </View>

      <View className="flex-row items-center gap-3">
        {/* 選択中は無効化しない。押し直しが「選択画面から戻れないとき」の
            唯一の復帰手段になるため。 */}
        <Pressable
          testID={`${testID}-pick`}
          onPress={() => void handlePick("library")}
          disabled={isUploading}
          accessibilityRole="button"
        >
          <Text className={isUploading ? "text-sm text-neutral-400" : "text-sm text-blue-600"}>
            {isPicking ? "画像を選び直す" : hasImage ? "画像を変更" : "画像を追加"}
          </Text>
        </Pressable>

        {Platform.OS !== "web" && (
          // web の expo-image-picker はカメラ指定でもファイル選択にフォールバック
          // するため、ギャラリーのボタンと同じ動作になる。モバイルだけ撮影導線を出す。
          <Pressable
            testID={`${testID}-camera`}
            onPress={() => void handlePick("camera")}
            disabled={isUploading}
            accessibilityRole="button"
          >
            <Text className={isUploading ? "text-sm text-neutral-400" : "text-sm text-blue-600"}>
              写真を撮る
            </Text>
          </Pressable>
        )}

        {hasImage && (
          <Pressable
            testID={`${testID}-remove`}
            onPress={handleRemove}
            disabled={isBusy}
            accessibilityRole="button"
          >
            <Text className={isBusy ? "text-sm text-neutral-400" : "text-sm text-red-600"}>
              画像を削除
            </Text>
          </Pressable>
        )}
      </View>

      {isPicking && (
        <Text testID={`${testID}-picking`} className="text-xs text-neutral-500">
          画像を選んでいます。選択画面が開かないときは、もう一度押してください。
        </Text>
      )}

      {upload.error && (
        <Text testID={`${testID}-error`} className="text-sm text-red-600">
          {upload.error}
        </Text>
      )}
    </View>
  );
}
