// ストレステスト（Stress test。Issue #147）。
//
// 目的: 平常の 2〜3 倍（30 → 45 VU）でも壊れず、緩やかに遅くなるだけで済むかを
// 確かめる。どこが最初に詰まるか（DB 接続数・Uvicorn のワーカー・CPU）を見つける。
//
// 形: 2 分で 30 VU → 5 分保つ → 2 分で 45 VU → 5 分保つ → 2 分で 0（合計 16 分）。
// アクセストークンの期限（15 分）をまたぐが、lib/auth.js が 10 分で取り直す。
// 実行: k6 run --summary-export <出力先>.json backend/perf/k6/stress.js
//
// 5xx の件数は lib/flow.js の `server_errors` カウンターで数える。
// http_req_failed は 4xx も含むので、サーバー側の失敗だけを別に判定するため。
// 503（混雑時の意図した縮退。Issue #191）は `shed_requests` に分けて数える。
// ストレスの範囲（45 VU）で 503 が出たら、それは想定より早く詰まっている合図なので
// 判定はしないが必ず目に入るよう、記録用の閾値を置いて要約に出す。
import { authHeaders, loginAll } from "./lib/auth.js";
import { browse } from "./lib/flow.js";

const STEP1_VUS = 30; // 平常の 200%
const STEP2_VUS = 45; // 平常の 300%

export const options = {
  stages: [
    { duration: "2m", target: STEP1_VUS },
    { duration: "5m", target: STEP1_VUS },
    { duration: "2m", target: STEP2_VUS },
    { duration: "5m", target: STEP2_VUS },
    { duration: "2m", target: 0 },
  ],
  thresholds: {
    // 平常の 2 倍（600ms）までの劣化は許容する。
    "http_req_duration{name:feed}": ["p(95)<600"],
    "http_req_duration{name:search}": ["p(95)<600"],
    // 詳細は判定せず記録だけする。
    "http_req_duration{name:detail}": [],
    http_req_failed: ["rate<0.01"],
    // 5xx（サーバー側の失敗）は 1 件も許さない。503 は含まない（下の shed_requests）。
    server_errors: ["count==0"],
    // 503（混雑時の縮退）は判定せず記録だけする。
    shed_requests: [],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  return loginAll(STEP2_VUS);
}

export default function (data) {
  browse(authHeaders(data));
}
