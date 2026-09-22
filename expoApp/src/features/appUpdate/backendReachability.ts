/**
 * backend固有の接続不能状態を持つストア（Issue #318）。
 *
 * 既存の`OfflineBanner`・`src/features/network/connectivity.ts`は
 * 「端末のネットワーク接続」を見ているだけで、「端末はオンラインだが
 * backendだけ落ちている」（AWS再構築中等）状態は判別できない。
 * このストアは`client.ts`の`onError`/`onResponse`からのみ更新される
 * （`client.ts` → ここへの一方向。circular importを避けるためここから
 * `client.ts`はimportしない）。
 */
import { create } from "zustand";

export type BackendReachabilityStatus = "ok" | "unreachable";

type BackendReachabilityStore = {
  status: BackendReachabilityStatus;
  markUnreachable: () => void;
  markReachable: () => void;
};

export const useBackendReachability = create<BackendReachabilityStore>((set) => ({
  status: "ok",
  markUnreachable: () => set({ status: "unreachable" }),
  markReachable: () => set({ status: "ok" }),
}));
