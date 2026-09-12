/**
 * タブの再タップなど、画面の外から来る「閉じる」を未保存ガードへ渡すためのストア。
 *
 * 画面が開いている間だけ、現在の画面が持つ requestClose を 1 つ登録する。
 * 画面が閉じたり、未保存の変更がなくなったりしたら登録を外す。
 */
import { create } from "zustand";

export type RequestClose = () => void;

type UnsavedChangesState = {
  requestClose: RequestClose | null;
  registerRequestClose: (requestClose: RequestClose) => void;
  clearRequestClose: (requestClose: RequestClose) => void;
};

export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  requestClose: null,
  registerRequestClose: (requestClose) => set({ requestClose }),
  clearRequestClose: (requestClose) =>
    set((state) => (state.requestClose === requestClose ? { requestClose: null } : state)),
}));
