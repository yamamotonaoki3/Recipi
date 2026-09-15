// 平均負荷テスト（Average-load test。Issue #146）。
//
// 目的: 平常の利用量（仮定: 同時 15 VU ＝ 100%）で、一覧・検索が非機能要件
// 「通常時 300ms 以内」（non-functional.md §パフォーマンス）を満たすかを確かめ、
// 今後の変更と比べるための基準値（ベースライン）を残す。
//
// 形: 1 分で 15 VU まで上げる → 5 分保つ → 1 分で 0 に下げる。
// 実行: k6 run --summary-export <出力先>.json backend/perf/k6/average-load.js
import { authHeaders, loginAll } from "./lib/auth.js";
import { browse } from "./lib/flow.js";

const PEAK_VUS = 15;

export const options = {
  stages: [
    { duration: "1m", target: PEAK_VUS },
    { duration: "5m", target: PEAK_VUS },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    // 非機能要件の 300ms は一覧（フィード）と検索に対する目安。
    "http_req_duration{name:feed}": ["p(95)<300"],
    "http_req_duration{name:search}": ["p(95)<300"],
    // 詳細は要件に数値が無いので、判定せず記録だけする（空の配列で結果に出す）。
    "http_req_duration{name:detail}": [],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
  // 結果に p(99) も出す（既定は p(90) / p(95) まで）。
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return loginAll(PEAK_VUS);
}

export default function (data) {
  browse(authHeaders(data));
}
