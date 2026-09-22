/**
 * 感想の入力欄（features/comment.md §2・§6。Issue #102）。
 *
 * 新規投稿と、自分の感想の編集（行の中にインラインで開く）の両方で使う。
 *
 * - 本文は複数行。前後の空白を除いて 1〜1000 文字のときだけ送れる
 * - 画像は 1 枚まで（`ImagePickerField` で選ぶ → その場で `POST /images`）
 * - 送信中・画像のアップロード中は送れない（画像なしで送られるのを防ぐ）
 *
 * 画像の送り方は API の約束（comment.md §3）に合わせて、親へ **「画像を変えたか」**
 * も一緒に渡す。編集で画像を触っていなければ `imageKey` を送らない（= 変更なし）、
 * 外したら null（= 削除）、選び直したら新しいキー（= 差し替え）にするため。
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { ImagePickerField } from "@/components/ImagePickerField";
import { countChars } from "@/lib/textLength";

/** 本文の上限（features/comment.md §6）。 */
export const COMMENT_MAX_LENGTH = 1000;

export type CommentDraft = {
  /** 前後の空白を除いた本文。 */
  body: string;
  /** 今の画像のキー（null = 画像なし）。 */
  imageKey: string | null;
  /** 最初の状態から画像を変えたか（選び直した・外した）。 */
  imageChanged: boolean;
};

type CommentComposerProps = {
  testID: string;
  /** 送信ボタンのラベル（投稿なら「送信」、編集なら「保存」）。 */
  submitLabel: string;
  /** 編集のときの最初の本文・画像。 */
  initialBody?: string;
  initialImage?: { key: string | null; url: string | null };
  /** 送る。成功したら true を返す（投稿なら入力を空に戻す）。 */
  onSubmit: (draft: CommentDraft) => Promise<boolean>;
  /** 編集のときだけ「キャンセル」を出す。 */
  onCancel?: () => void;
  /** 送信中か（親の mutation の状態）。 */
  submitting: boolean;
  /** 送信の失敗メッセージ。 */
  error?: string | null;
  /**
   * 本文を編集したときに、親が持つ `error`（サーバー由来）を消してもらうための通知。
   * 呼ばないと、再送信するまで古いエラー文言が画面に残り続ける（Issue #320）。
   */
  onErrorDismiss?: () => void;
  /** 成功したあと入力を空に戻すか（新規投稿は true、編集は false）。 */
  resetOnSuccess?: boolean;
};

export function CommentComposer({
  testID,
  submitLabel,
  initialBody = "",
  initialImage = { key: null, url: null },
  onSubmit,
  onCancel,
  submitting,
  error,
  onErrorDismiss,
  resetOnSuccess = false,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialBody);
  const [image, setImage] = useState(initialImage);
  const [imageChanged, setImageChanged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trimmed = body.trim();
  // JavaScript の string.length は絵文字を 2 文字として数えることがある。
  // サーバーと同じコードポイント数で数えることで、入力欄とサーバーの上限をそろえる。
  const trimmedLength = countChars(trimmed);
  const tooLong = trimmedLength > COMMENT_MAX_LENGTH;
  const canSubmit = trimmedLength > 0 && !tooLong && !submitting && !uploading;
  const inlineValidationMessage =
    body.length > 0 && trimmedLength === 0
      ? "感想を入力してください"
      : tooLong
        ? `感想は${COMMENT_MAX_LENGTH}文字以内で入力してください`
        : null;
  const visibleError = validationError ?? error ?? inlineValidationMessage;

  async function handleSubmit() {
    if (trimmedLength === 0) {
      setValidationError("感想を入力してください");
      return;
    }
    if (tooLong) {
      setValidationError(`感想は${COMMENT_MAX_LENGTH}文字以内で入力してください`);
      return;
    }
    if (!canSubmit) return;
    setValidationError(null);
    const ok = await onSubmit({ body: trimmed, imageKey: image.key, imageChanged });
    if (ok && resetOnSuccess) {
      setBody("");
      setImage({ key: null, url: null });
      setImageChanged(false);
    }
  }

  return (
    <View testID={testID} className="gap-2">
      <TextInput
        testID={`${testID}-input`}
        value={body}
        onChangeText={(value) => {
          setBody(value);
          setValidationError(null);
          onErrorDismiss?.();
        }}
        editable={!submitting}
        placeholder="作ってみた感想を書く"
        multiline
        textAlignVertical="top"
        className="min-h-20 rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
      />
      <Text
        testID={`${testID}-count`}
        className={`self-end text-xs ${tooLong ? "text-red-600" : "text-neutral-400"}`}
      >
        {trimmedLength} / {COMMENT_MAX_LENGTH}
      </Text>

      <ImagePickerField
        testID={`${testID}-image`}
        variant="step"
        placeholder="写真を追加（任意）"
        imageKey={image.key}
        imageUrl={image.url}
        disabled={submitting}
        onChange={(key, url) => {
          if (submitting) return;
          setImage({ key, url });
          setImageChanged(true);
        }}
        onUploadingChange={setUploading}
      />

      {visibleError ? (
        <Text testID={`${testID}-error`} className="text-sm text-red-600">
          {visibleError}
        </Text>
      ) : null}

      <View className="flex-row justify-end gap-2">
        {onCancel && (
          <Pressable
            testID={`${testID}-cancel`}
            onPress={() => {
              if (!submitting) onCancel();
            }}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            className="rounded-lg px-4 py-2"
          >
            <Text className="text-neutral-600">キャンセル</Text>
          </Pressable>
        )}
        <Pressable
          testID={`${testID}-submit`}
          onPress={() => void handleSubmit()}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          className={`rounded-lg px-4 py-2 ${canSubmit ? "bg-orange-500" : "bg-neutral-300"}`}
        >
          <Text className="font-semibold text-white">{submitting ? "送信中…" : submitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
