// スモークテスト（Issue #145）。
//
// 目的: 負荷をかける前に「スクリプト・テストデータ・API がそろって動くか」を確かめる。
// 1 VU で 1 分だけ閲覧シナリオを回し、失敗が 1 件でもあれば不合格にする。
// 速さは判定しない（それは average-load.js 以降の役目）。
//
// 実行: k6 run backend/perf/k6/smoke.js   （先に seed_perf を実行しておく）
import { authHeaders, loginAll } from "./lib/auth.js";
import { browse } from "./lib/flow.js";

export const options = {
  vus: 1,
  duration: "1m",
  thresholds: {
    // HTTP の失敗（4xx / 5xx・接続エラー）が 0 件。
    http_req_failed: ["rate==0"],
    // check（200 か・検索にヒットがあるか）がすべて成功。
    checks: ["rate==1"],
  },
};

export function setup() {
  return loginAll(1);
}

export default function (data) {
  browse(authHeaders(data));
}
