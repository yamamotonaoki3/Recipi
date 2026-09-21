/**
 * 選択中の destination の再タップを、その destination の画面へ伝える（Issue #249）。
 *
 * ナビバー（`(tabs)/_layout.tsx`）と一覧画面は親子ではないので、小さな store を仲介にする。
 * ナビバーは `notifyRetap(href)` を呼ぶだけ、画面は `useRetap(basePath, ...)` で購読する。
 * 回数を数えるのは、同じ値の連続通知でも購読側が変化として受け取れるようにするため。
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";

type RetapState = { counts: Record<string, number> };

export const useRetapStore = create<RetapState>(() => ({ counts: {} }));

/** `href`（`/home` など）の destination が再タップされたことを通知する。 */
export function notifyRetap(href: string): void {
  useRetapStore.setState((state) => ({
    counts: { ...state.counts, [href]: (state.counts[href] ?? 0) + 1 },
  }));
}

/** `href` の destination が再タップされたら `onRetap` を呼ぶ。 */
export function useRetap(href: string, onRetap: () => void): void {
  const latest = useRef(onRetap);
  useEffect(() => {
    latest.current = onRetap;
  });
  useEffect(
    () =>
      useRetapStore.subscribe((state, prev) => {
        if (state.counts[href] !== prev.counts[href]) latest.current();
      }),
    [href],
  );
}
