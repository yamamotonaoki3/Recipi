// スパイクテスト（Spike test。Issue #148）。
//
// 目的: アクセスが急に増えても（平常 15 VU → 100 VU、約 6.7 倍）プロセスが落ちず、
// 平常に戻った後に自力で元の速さへ戻れるかを確かめる。
//
// 形（2 つのシナリオを時間でつなぐ）:
//   spike    … 15 VU（1 分）→ 10 秒で 100 VU → 1 分保つ → 10 秒で 15 VU
//   recovery … その直後から 15 VU を 2 分。`phase:recovery` タグを付け、
//              この区間だけで「回復できたか」を判定する
// 実行: k6 run --summary-export <出力先>.json backend/perf/k6/spike.js
import { authHeaders, loginAll } from "./lib/auth.js";
import { browse } from "./lib/flow.js";

const BASE_VUS = 15;
const SPIKE_VUS = 100;

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: BASE_VUS,
      stages: [
        { duration: "1m", target: BASE_VUS },
        { duration: "10s", target: SPIKE_VUS },
        { duration: "1m", target: SPIKE_VUS },
        { duration: "10s", target: BASE_VUS },
      ],
      gracefulRampDown: "0s",
      tags: { phase: "spike" },
    },
    recovery: {
      executor: "constant-vus",
      vus: BASE_VUS,
      duration: "2m",
      // spike シナリオ（合計 2 分 20 秒）が終わった直後に始める。
      startTime: "2m20s",
      tags: { phase: "recovery" },
    },
  },
  thresholds: {
    // 急増中の失敗はある程度許す（全体で 5% 未満）。
    http_req_failed: ["rate<0.05"],
    // 回復区間では、平常と同じ基準（300ms）に戻っていること。
    "http_req_duration{name:feed,phase:recovery}": ["p(95)<300"],
    "http_req_duration{name:search,phase:recovery}": ["p(95)<300"],
    // 急増中の値は判定せず記録だけする。
    "http_req_duration{phase:spike}": [],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return loginAll(SPIKE_VUS);
}

export default function (data) {
  browse(authHeaders(data));
}
