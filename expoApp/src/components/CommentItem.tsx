/**
 * 感想アイテム（screens/components.md §感想アイテム。Issue #102）。
 *
 * 投稿者行（アバター + 表示名）＋ 投稿日時、本文、添付画像（あれば）。
 *
 * - 自分の感想: 「編集」「削除」。編集は行の中に入力欄を開いてその場で直す
 * - 自分がレシピ投稿者: 他人の感想にも「削除」（モデレーション。編集はできない）
 *
 * 削除の確認ダイアログは親（レシピ詳細）が 1 つだけ持つ。ここは「削除したい」と
 * 知らせるだけにして、行ごとにダイアログを作らない。
 */
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { CommentComposer, type CommentDraft } from "@/components/CommentComposer";
import type { Comment } from "@/features/comment/api";

/** 投稿日時を「2026/09/12 18:05」の形にする（端末の時刻で表示）。 */
export function formatCommentDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type CommentItemProps = {
  comment: Comment;
  testID: string;
  /** 自分の感想なら true（編集・削除を出す）。 */
  isMine: boolean;
  /** 自分がこのレシピの投稿者なら true（他人の感想にも削除を出す）。 */
  isRecipeOwner: boolean;
  onPressAuthor: () => void;
  onRequestDelete: () => void;
  /** 編集を保存する。成功したら true。 */
  onSave: (draft: CommentDraft) => Promise<boolean>;
  saving: boolean;
  saveError?: string | null;
  /**
   * 削除の通信中なら true。その間は「編集」「削除」を押せなくし、行を薄く出す
   * （同じ感想をもう一度削除して、2 回目の失敗が表示されるのを防ぐ。Issue #130）。
   */
  deleting?: boolean;
};

export function CommentItem({
  comment,
  testID,
  isMine,
  isRecipeOwner,
  onPressAuthor,
  onRequestDelete,
  onSave,
  saving,
  saveError,
  deleting = false,
}: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const canDelete = isMine || isRecipeOwner;

  return (
    <View
      testID={testID}
      className={`gap-2 border-b border-neutral-100 pb-3 ${deleting ? "opacity-50" : ""}`}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          testID={`${testID}-author`}
          onPress={onPressAuthor}
          accessibilityRole="button"
          className="flex-row items-center gap-2"
        >
          <Avatar
            url={comment.author.avatarUrl}
            displayName={comment.author.displayName}
            size={24}
          />
          <Text className="text-sm font-semibold text-neutral-700">
            {comment.author.displayName}
          </Text>
        </Pressable>
        <Text testID={`${testID}-date`} className="text-xs text-neutral-400">
          {formatCommentDate(comment.createdAt)}
        </Text>
      </View>

      {editing ? (
        <CommentComposer
          testID={`${testID}-editor`}
          submitLabel="保存"
          initialBody={comment.body}
          // レスポンスには画像の URL しか無く、キーは返ってこない。入力欄に「画像あり」と
          // 判断させるための仮の値で、画像を触らなければ（imageChanged が false）送らない。
          initialImage={{ key: comment.imageUrl ? "current" : null, url: comment.imageUrl }}
          submitting={saving}
          error={saveError}
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            const ok = await onSave(draft);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <>
          <Text testID={`${testID}-body`} className="text-base text-neutral-800">
            {comment.body}
          </Text>
          {comment.imageUrl ? (
            <Image
              testID={`${testID}-image`}
              source={{ uri: comment.imageUrl }}
              style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 8 }}
              contentFit="cover"
            />
          ) : null}
          {(isMine || canDelete) && (
            <View className="flex-row justify-end gap-4">
              {isMine && (
                <Pressable
                  testID={`${testID}-edit`}
                  onPress={() => setEditing(true)}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deleting }}
                >
                  <Text className="text-sm text-orange-600">編集</Text>
                </Pressable>
              )}
              {canDelete && (
                <Pressable
                  testID={`${testID}-delete`}
                  onPress={onRequestDelete}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deleting }}
                >
                  <Text className="text-sm text-red-600">削除</Text>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}
