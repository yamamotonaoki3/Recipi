/**
 * プロフィールの TanStack Query hooks（Issue #94）。
 *
 * - 自分のプロフィール取得: `useMyProfile`
 * - 設定の保存（表示名・公開トグル・URL）: `useUpdateProfile`
 * - アバターの設定 / 削除: `useAvatarUpload` / `useDeleteAvatar`
 *
 * 表示名とアバターは**他の画面にも出る**（フィード・履歴・自分のレシピ一覧・
 * レシピ詳細の投稿者）。変えたらそれらのキャッシュも無効化して張り替える。
 * destination ごとにスタックが分かれていて、画面がマウントされたまま残るため、
 * 再マウント時の再取得には頼れない（lessons #42 と同じ理由）。
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { FEED_ROOT_KEY } from "@/features/feed/hooks";
import { HISTORY_ROOT_KEY } from "@/features/history/hooks";
import type { UploadFile } from "@/features/image/api";
import { usePickAndSend } from "@/features/image/usePickAndSend";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

import {
  deleteAvatar,
  getMyProfile,
  putAvatar,
  updateMe,
  type UpdateMeRequest,
  type UserSelfProfile,
} from "./api";

export const PROFILE_ROOT_KEY = ["profile"] as const;

export const profileKeys = {
  detail: (userId: string) => ["profile", userId] as const,
};

/** 投稿者の表示名・アバターが載っている一覧・詳細をすべて張り替える。 */
function invalidateAuthorAppearance(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: PROFILE_ROOT_KEY });
  void queryClient.invalidateQueries({ queryKey: FEED_ROOT_KEY });
  void queryClient.invalidateQueries({ queryKey: HISTORY_ROOT_KEY });
  void queryClient.invalidateQueries({ queryKey: ["my-recipes"] });
  void queryClient.invalidateQueries({ queryKey: ["recipe"] });
}

/**
 * 自分のプロフィール（全項目 ＋ 公開トグル ＋ フォロー数）。
 *
 * セッションの復元が終わってログイン済みになるまでは送らない
 * （復元前に投げると 401 → 保存済みトークンが消される。lessons #42-15）。
 */
export function useMyProfile() {
  const hydrated = useSession((s) => s.hydrated);
  const isAuthenticated = useSession((s) => s.isAuthenticated);
  const userId = useSession((s) => s.user?.id);

  const query = useQuery({
    queryKey: profileKeys.detail(userId ?? ""),
    queryFn: () => getMyProfile(userId as string),
    enabled: hydrated && isAuthenticated && Boolean(userId),
  });

  // ログイン済みなのに user だけ無いと、enabled が false のままになって
  // いつまでも「読み込み中」に見える。保存済みのユーザー情報が欠けた状態として
  // 画面側でログインし直しを案内できるようにする。
  const missingUser = hydrated && isAuthenticated && !userId;
  return { ...query, missingUser };
}

/**
 * プロフィール設定の保存（変更した項目だけを送る）。
 *
 * 表示名はセッションにも持っている（マイページや詳細の「自分かどうか」の
 * 判定に使う）ので、成功したらそちらも更新する。rememberMe のときは
 * 永続化してから状態に反映する（次回起動時に古い名前へ巻き戻らないように。
 * 順序の理由は lessons #36-1）。
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateMeRequest) => {
      const result = await updateMe(body);
      const current = useSession.getState();
      if (current.user && current.user.displayName !== result.displayName) {
        const updatedUser = { ...current.user, displayName: result.displayName };
        if (current.rememberMe) {
          await secureStorage.setUser(JSON.stringify(updatedUser));
        }
        useSession.setState({ user: updatedUser });
      }
      return result;
    },
    onSuccess: () => invalidateAuthorAppearance(queryClient),
  });
}

/** 取得済みの自分のプロフィールの `avatarUrl` だけを書き換える（再取得を待たず即時に反映）。 */
function setCachedAvatar(
  queryClient: QueryClient,
  userIdAtStart: string | undefined,
  avatarUrl: string | null,
) {
  // 途中で別のユーザーへ切り替わっていたら、前のユーザーの結果を今のユーザーへ
  // 混ぜない。書き込みだけでなく、関連画面の再取得も行わない。
  if (!userIdAtStart || useSession.getState().user?.id !== userIdAtStart) return false;
  queryClient.setQueryData<UserSelfProfile>(profileKeys.detail(userIdAtStart), (old) =>
    old ? { ...old, avatarUrl } : old,
  );
  return true;
}

/**
 * アバターを選んで `PUT /users/me/avatar` へ送る。
 *
 * 選択中 / 送信中の分け方・押し直しの扱いはレシピ画像と同じ（usePickAndSend）。
 * 成功したら、編集画面・マイページ・一覧に**その場で**反映する。
 */
export function useAvatarUpload() {
  const queryClient = useQueryClient();
  const send = useCallback(
    async (file: UploadFile) => {
      // 完了時ではなく、アップロードを開始する直前のユーザーを覚えておく。
      const userIdAtStart = useSession.getState().user?.id;
      const { avatarUrl } = await putAvatar(file);
      if (setCachedAvatar(queryClient, userIdAtStart, avatarUrl)) {
        invalidateAuthorAppearance(queryClient);
      }
      return avatarUrl;
    },
    [queryClient],
  );
  return usePickAndSend(send);
}

/** アバターを外す。 */
export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAvatar,
    onMutate: () => ({ userIdAtStart: useSession.getState().user?.id }),
    onSuccess: (_data, _variables, context) => {
      if (setCachedAvatar(queryClient, context?.userIdAtStart, null)) {
        invalidateAuthorAppearance(queryClient);
      }
    },
  });
}
