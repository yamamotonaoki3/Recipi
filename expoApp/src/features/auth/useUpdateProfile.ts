/**
 * プロフィール編集（表示名のみ）用の hook。
 *
 * Issue #36 のスコープは表示名のみ（アバター・SNS リンク等は Phase 5 以降）。
 * 本来の置き場所は `features/profile/` が適切だが、Phase 1 時点では
 * プロフィール機能がこれしか無いため、いったん `features/auth/` に置く
 * （Phase 5 でプロフィール機能が育ったタイミングで移設する想定）。
 */
import { useMutation } from "@tanstack/react-query";

import { updateMe } from "./api";
import { secureStorage } from "@/lib/secureStorage";
import { useSession } from "@/store/session";

export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (input: { displayName: string }) => {
      const result = await updateMe(input);
      const current = useSession.getState();
      if (current.user) {
        const updatedUser = { ...current.user, displayName: result.displayName };
        // 他の箇所（useLogin 等）と同じ理由で、永続化してから状態に反映する。
        // rememberMe セッションでは useAuthRefresh が secureStorage 上の
        // ユーザー情報をそのまま復元するため、ここで更新しておかないと
        // 次回起動時に表示名が古いものへ巻き戻ってしまう。
        if (current.rememberMe) {
          await secureStorage.setUser(JSON.stringify(updatedUser));
        }
        useSession.setState({ user: updatedUser });
      }
      return result;
    },
  });
}
