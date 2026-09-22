/**
 * 「後で」を選んだReleaseのバージョンを、同一起動中だけ覚えるストア（Issue #318）。
 *
 * 永続化しない（次回起動時・アプリ情報画面からは再確認できる、という
 * 受け入れ基準どおり）。
 */
import { create } from "zustand";

type UpdateDismissalStore = {
  dismissedVersion: string | null;
  dismiss: (version: string) => void;
  reset: () => void;
};

export const useUpdateDismissal = create<UpdateDismissalStore>((set) => ({
  dismissedVersion: null,
  dismiss: (version) => set({ dismissedVersion: version }),
  reset: () => set({ dismissedVersion: null }),
}));
