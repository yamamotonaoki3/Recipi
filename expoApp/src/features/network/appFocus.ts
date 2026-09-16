/**
 * スマホ（Android / iOS）で「アプリに戻ってきた」ことを TanStack Query に伝える
 * （Issue #186）。
 *
 * ## なぜ必要か
 *
 * TanStack Query の `focusManager` は、既定ではブラウザの `focus` / `visibilitychange`
 * だけを見る。Web（ブラウザ・Tauri）はそれで足りるが、**Android / iOS にはその
 * 知らせが無い**ので、何もしないと「復帰したら取り直す」（`refetchOnWindowFocus`）が
 * ネイティブでは一切働かない。
 *
 * これを配線すると、次の 2 つが効くようになる:
 *
 * - **期限切れの画像 URL の立て直し**（Issue #186 の本題）。アプリを閉じて
 *   しばらくして戻ってくると、レスポンスごと取り直して新しい署名付き URL を得る
 * - 通知一覧の `refetchOnWindowFocus: true`（Issue #70 で書かれていたが、
 *   ネイティブでは実質働いていなかった）
 *
 * `onlineManager` の配線（`connectivity.ts`。Issue #133）と対になる仕組み。
 */
import { focusManager } from "@tanstack/react-query";
import { AppState, Platform, type AppStateStatus } from "react-native";

/** `AppState` の状態から「フォーカスされているか」を決める。 */
export function isFocusedState(status: AppStateStatus): boolean {
  // "active" 以外（background / inactive）は、画面が見えていないので未フォーカス扱い。
  return status === "active";
}

/**
 * 起動時に 1 回だけ呼ぶ。Web では何もしない（ブラウザの知らせを TanStack Query が使う）。
 */
export function setupNativeAppFocus(): void {
  if (Platform.OS === "web") return;

  AppState.addEventListener("change", (status) => {
    focusManager.setFocused(isFocusedState(status));
  });
}
