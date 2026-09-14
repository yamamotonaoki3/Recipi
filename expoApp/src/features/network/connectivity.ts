/**
 * スマホ（Android / iOS）の通信状態を TanStack Query に伝える（Issue #133）。
 *
 * TanStack Query の `onlineManager` は、既定ではブラウザの online / offline の知らせだけを
 * 見る。Web（ブラウザ・Tauri）はそれで足りるが、Android / iOS にはその知らせが無いので、
 * 何もしないと電波が切れても「オンライン」のままになる。すると、
 * - オフラインの案内（`OfflineBanner`）が出ない
 * - 読み込みや送信が一時停止せず、つながったときの自動のやり直しも起きない
 * （Codex レビュー指摘）。そこで expo-network の知らせを `onlineManager` に渡す。
 *
 * 判定: `isConnected` か `isInternetReachable` が **はっきり false** のときだけオフライン。
 * どちらも「分からない」（undefined / null）ことがあり、起動直後にまだ判定できていない状態を
 * 切断と取り違えて、つながっているのに一時停止させないため。
 */
import { onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import { Platform } from "react-native";

/** expo-network の状態から、オンラインとみなすかを決める。 */
export function isOnlineState(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/**
 * 起動時に 1 回だけ呼ぶ。Web では何もしない（ブラウザの知らせを TanStack Query が使う）。
 */
export function setupNativeConnectivity(): void {
  if (Platform.OS === "web") return;

  onlineManager.setEventListener((setOnline) => {
    // 起動した時点の状態を先に反映する（最初の変化を待つあいだ、ずれたままにしない）。
    void Network.getNetworkStateAsync()
      .then((state) => setOnline(isOnlineState(state)))
      .catch(() => undefined);

    const subscription = Network.addNetworkStateListener((state) => {
      setOnline(isOnlineState(state));
    });
    // onlineManager が別の購読に切り替えるときに、この購読を外す。購読の戻り値が
    // 取れない環境（テストの仮のモジュールなど）でも落ちないよう、あるときだけ外す。
    return () => subscription?.remove?.();
  });
}
