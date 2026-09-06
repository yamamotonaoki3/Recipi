/**
 * クライアント側の「セッション状態」を持つストア（Zustand）。
 *
 * Zustand は「1 つのオブジェクト（ストア）を作って、どのコンポーネントからでも
 * フックで読み書きできる」シンプルな状態管理ライブラリ。
 *
 * ここに置くのは **サーバーから取ってくるデータではない**もの:
 * - アクセストークン・リフレッシュトークン（メモリ上）
 * - ログイン中のユーザー情報（displayName 等、表示用の最小限）
 * - ログイン済みかどうか
 * - 「ログインを保持」の選択（rememberMe。true ならリフレッシュトークンを
 *   セキュアストレージにも永続化する）
 * - 認可ゲートに関する状態（hydrated。詳細は
 *   src/features/auth/useProtectedRoute.ts を参照）
 * レシピ一覧などのサーバーデータは TanStack Query が持つ（src/api/）。
 *
 * secureStorage への読み書き（永続化）はこのストア自身では行わない。
 * 「rememberMe のときだけ永続化する」という判断は呼び出し側
 * （useLogin の成功時ハンドラ、client.ts のリフレッシュ処理など）の
 * 責務にすることで、このストアをストレージ I/O から独立させ、
 * 単体テストしやすくしている。
 */
import { create } from "zustand";

export type SessionUser = {
  id: string;
  displayName: string;
};

type SetAuthArgs = {
  accessToken: string;
  refreshToken: string;
  user?: SessionUser | null;
  rememberMe: boolean;
};

type SessionState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  rememberMe: boolean;
  isAuthenticated: boolean;
  /** splash でのセッション復元（自動 refresh）試行が完了したか。 */
  hydrated: boolean;

  /** login / signup 成功時、および refresh 成功時（ユーザー情報の更新が無い場合は user を省略）に呼ぶ。 */
  setAuth: (args: SetAuthArgs) => void;
  /** refresh のレスポンスは user を含まないため、アクセストークンだけ更新したいときに使う。 */
  setAccessTokenOnly: (accessToken: string, refreshToken: string) => void;
  setHydrated: (value: boolean) => void;
  /** ログアウト・アカウント削除・リフレッシュ失敗時に呼ぶ。メモリ上の状態のみ消去する。 */
  clear: () => void;
};

export const useSession = create<SessionState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  rememberMe: false,
  isAuthenticated: false,
  hydrated: false,

  setAuth: ({ accessToken, refreshToken, user, rememberMe }) =>
    set((state) => ({
      accessToken,
      refreshToken,
      rememberMe,
      isAuthenticated: true,
      user: user === undefined ? state.user : user,
    })),

  setAccessTokenOnly: (accessToken, refreshToken) =>
    set({ accessToken, refreshToken, isAuthenticated: true }),

  setHydrated: (value) => set({ hydrated: value }),

  clear: () =>
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      rememberMe: false,
      isAuthenticated: false,
    }),
}));
