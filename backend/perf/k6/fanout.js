// 公開レシピ作成から通知fan-outを起動する探索的測定（Issue #248）。
//
// これは投稿APIの応答時間と、fan-outを起動できた件数を測るシナリオ。
// outbox / notifications の厳密な件数と処理完了時刻は、出力された recipe_id を
// 使って別トランザクションから確認する（testing.md §性能テスト）。
// 実行例:
//   k6 run -e BASE_URL=http://localhost:8000 -e FANOUT_ITERATIONS=3 \
//     backend/perf/k6/fanout.js

import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

import { API } from "./lib/config.js";
import { authHeaders, loginAll } from "./lib/auth.js";

const ITERATIONS = Number(__ENV.FANOUT_ITERATIONS || 3);
export const fanoutCreated = new Counter("fanout_created");

export const options = {
  scenarios: {
    fanout: {
      executor: "shared-iterations",
      vus: 1,
      iterations: ITERATIONS,
      maxDuration: "5m",
    },
  },
  thresholds: {
    "http_req_duration{name:fanout-post}": [],
    fanout_created: [`count==${ITERATIONS}`],
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
};

export function setup() {
  return loginAll(1);
}

export default function (data) {
  const title = `[PERF_TEST] fanout-${__VU}-${__ITER}-${Date.now()}`;
  const response = http.post(
    `${API}/recipes`,
    JSON.stringify({
      title,
      description: "[PERF_TEST] fan-out notification measurement",
      servings: 1,
      isPublic: true,
      ingredientGroups: [{ name: null, ingredients: [{ name: "水" }] }],
      steps: [{ body: "[PERF_TEST] fan-out measurement" }],
    }),
    { headers: { ...authHeaders(data), "Content-Type": "application/json" }, tags: { name: "fanout-post" } },
  );

  const created = check(response, {
    "fanout post is 201": (res) => res.status === 201,
    "fanout response has recipe id": (res) => res.status === 201 && Boolean(res.json("id")),
  });
  if (!created) fail(`fan-out投稿が成立しませんでした（status=${response.status}）`);

  fanoutCreated.add(1);
  console.log(`fanout recipe_id=${response.json("id")} title=${title}`);
}
