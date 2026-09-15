/**
 * タブの再タップなど、画面の外から来る「閉じる」を未保存ガードへ渡すためのストア。
 *
 * 登録は 2 種類ある。
 *
 * - `requestClose`: **いま表示中**の画面が持つ requestClose を 1 つだけ。
 *   選択中のタブをもう一度押したときに使う。画面がフォーカスを失ったり、
 *   未保存の変更がなくなったりしたら登録を外す。
 * - `pendingByDestination`: **別のタブへ移って裏に残った**編集画面の requestClose を、
 *   destination（`/my-page` など）ごとに持つ。フォーカスが外れても登録を残し、
 *   画面が閉じるか未保存の変更がなくなったら外す。別のタブからその destination へ
 *   戻ってきたとき、最初の画面へ戻す前に確認ダイアログを出すために使う（Issue #156）。
 */
import { create } from "zustand";

export type RequestClose = () => void;

type UnsavedChangesState = {
  requestClose: RequestClose | null;
  registerRequestClose: (requestClose: RequestClose) => void;
  clearRequestClose: (requestClose: RequestClose) => void;
  pendingByDestination: Partial<Record<string, RequestClose>>;
  registerPending: (destination: string, requestClose: RequestClose) => void;
  clearPending: (destination: string, requestClose: RequestClose) => void;
};

export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  requestClose: null,
  registerRequestClose: (requestClose) => set({ requestClose }),
  clearRequestClose: (requestClose) =>
    set((state) => (state.requestClose === requestClose ? { requestClose: null } : state)),
  pendingByDestination: {},
  registerPending: (destination, requestClose) =>
    set((state) => ({
      pendingByDestination: { ...state.pendingByDestination, [destination]: requestClose },
    })),
  // 自分が登録したものだけを外す。後から別の画面が同じ destination に登録していたら残す。
  clearPending: (destination, requestClose) =>
    set((state) => {
      if (state.pendingByDestination[destination] !== requestClose) return state;
      const next = { ...state.pendingByDestination };
      delete next[destination];
      return { pendingByDestination: next };
    }),
}));
