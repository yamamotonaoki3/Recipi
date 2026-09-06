/**
 * 認可ゲート（保護ルートを守る hook）。
 *
 * `app/(app)/_layout.tsx` の先頭でこの hook を呼ぶだけで、配下の全画面が
 * 「ログイン済みでないと見られない」画面になる。
 *
 * navigation.md の要求:
 * 「未ログインで保護画面に到達しようとしたら、ログイン画面へ差し替える。
 *   ログイン/サインアップ成功後は常にホームへ。」（Issue #53 で
 *   「元々行こうとしていた画面へ戻す」挙動を廃止した）
 *
 * `hydrated` が false の間（= スプラッシュでの自動ログイン復元がまだ
 * 終わっていない間）は何もしない。ここで判定してしまうと、復元が
 * 終わる前の一瞬 `isAuthenticated === false` を見て、本当はログイン
 * 済みになるはずのユーザーを誤ってログイン画面へ弾いてしまう。
 *
 * トークン失効の検知・破棄そのものは `src/api/client.ts` の 401
 * ハンドリングが担当する。この hook は `isAuthenticated` の変化を
 * 見て「画面を切り替える」ことだけに専念する（責務を分けている）。
 */
import { useRouter } from "expo-router";
import { useEffect } from "react";

import { useSession } from "@/store/session";

export function useProtectedRoute(): void {
  const isAuthenticated = useSession((s) => s.isAuthenticated);
  const hydrated = useSession((s) => s.hydrated);
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (isAuthenticated) return;

    // 行こうとしていた画面は覚えない（Issue #53）。認証後は常にホームへ着地する。
    router.replace("/(auth)/login");
  }, [isAuthenticated, hydrated, router]);
}
