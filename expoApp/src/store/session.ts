/**
 * クライアント側の「セッション状態」を持つストア（Zustand）。
 *
 * Zustand は「1 つのオブジェクト（ストア）を作って、どのコンポーネントからでも
 * フックで読み書きできる」シンプルな状態管理ライブラリ。
 *
 * ここに置くのは **サーバーから取ってくるデータではない**もの:
 * - アクセストークン（メモリ上。永続化は Phase 1 でセキュアストレージに）
 * - ログイン済みかどうか
 * レシピ一覧などのサーバーデータは TanStack Query が持つ（src/api/）。
 */
import { create } from "zustand";

type SessionState = {
  accessToken: string | null;
  isAuthenticated: boolean;
  setAccessToken: (token: string | null) => void;
  clear: () => void;
};

export const useSession = create<SessionState>((set) => ({
  accessToken: null,
  isAuthenticated: false,
  setAccessToken: (token) => set({ accessToken: token, isAuthenticated: token !== null }),
  clear: () => set({ accessToken: null, isAuthenticated: false }),
}));
