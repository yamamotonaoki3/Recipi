// fan-out の継続到着率測定（Issue #260）。
// API 201 だけで合格にせず、recipe_id を verify_fanout.py で別途検証する。
// 実行例: k6 run -e PERF_USERS=1001 -e FANOUT_RATE=1 -e FANOUT_DURATION=5m fanout-strict.js
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";

import { API } from "./lib/config.js";
import { authHeaders, loginAll } from "./lib/auth.js";

const RATE = Number(__ENV.FANOUT_RATE || 1);
const DURATION = __ENV.FANOUT_DURATION || "5m";
const VUS = Number(__ENV.FANOUT_PREALLOCATED_VUS || Math.max(2, RATE * 3));

export const plannedIterations = new Counter("fanout_planned_iterations");
export const startedIterations = new Counter("fanout_started_iterations");
export const completedIterations = new Counter("fanout_completed_iterations");
export const failedIterations = new Counter("fanout_failed_iterations");
export const failedRate = new Rate("fanout_failed_rate");

export const options = {
  scenarios: {
    fanout: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: Math.max(VUS, RATE * 10),
    },
  },
  thresholds: {
    "http_req_failed{name:fanout-post}": ["rate==0"],
    "checks{name:fanout-post}": ["rate==1"],
    fanout_failed_rate: ["rate==0"],
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
};

export function setup() {
  const durationSeconds = DURATION.endsWith("m")
    ? Number(DURATION.slice(0, -1)) * 60
    : Number(DURATION.slice(0, -1));
  plannedIterations.add(RATE * durationSeconds);
  return loginAll(1);
}

export default function (data) {
  startedIterations.add(1);
  const response = http.post(
    `${API}/recipes`,
    JSON.stringify({
      title: `[PERF_TEST] strict-fanout-${__VU}-${__ITER}-${Date.now()}`,
      description: "[PERF_TEST] strict fan-out measurement",
      servings: 1,
      isPublic: true,
      ingredientGroups: [{ name: null, ingredients: [{ name: "水" }] }],
      steps: [{ body: "[PERF_TEST] strict fan-out measurement" }],
    }),
    { headers: { ...authHeaders(data), "Content-Type": "application/json" }, tags: { name: "fanout-post" } },
  );
  const ok = check(response, {
    "fanout post is 201": (res) => res.status === 201,
    "fanout response has recipe id": (res) => res.status === 201 && Boolean(res.json("id")),
  });
  if (ok) {
    completedIterations.add(1);
    failedRate.add(false);
    console.log(`fanout recipe_id=${response.json("id")}`);
  } else {
    failedIterations.add(1);
    failedRate.add(1);
  }
}
