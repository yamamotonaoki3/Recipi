// 性能テストの閲覧シナリオ（Issue #145）。スモーク・平均負荷・ストレス・スパイクで共通。
//
// 1 回の流れ: ホーム「全体」フィードを 3 ページ（カーソルで続き）→ 材料名で検索 → レシピ詳細。
// リクエストごとに `name` タグ（feed / search / detail）を付け、閾値（thresholds）を
// API ごとに分けて判定できるようにする。`extraTags` は呼び出し側の追加タグ（スパイクの
// `phase` など）。
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

import { API, THINK_TIME, vocabulary } from "./config.js";

const FEED_PAGES = 3;
const PAGE_SIZE = 20;

// 5xx（サーバー側の失敗）の件数（Issue #147）。`http_req_failed` は 4xx も含むので、
// 「サーバーが壊れたか」だけを見たいストレステストでは別に数えて判定する。
// どのテストでも数えるが、閾値を付けているのは stress.js だけ。
//
// **503 はここに数えない**（Issue #191）。503 は「今は捌けないので待って」という
// 意図した縮退で、バグによる失敗とは意味が違う。混ぜると、対策が効いて 500 が
// 503 に変わったとたんに `server_errors: ["count==0"]` が落ち、改善が失敗に
// 見えてしまう。503 は shed_requests（切り捨てた要求）として別に数える。
export const serverErrors = new Counter("server_errors");
export const shedRequests = new Counter("shed_requests");

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** GET して、5xx なら server_errors に数える（503 だけは shed_requests に分ける）。 */
function get(url, headers, tags) {
  const res = http.get(url, { headers, tags });
  if (res.status === 503) shedRequests.add(1, tags);
  else if (res.status >= 500) serverErrors.add(1, tags);
  return res;
}

export function browse(headers, extraTags = {}) {
  const tags = (name) => ({ name, ...extraTags });
  const recipeIds = [];

  // --- フィード（新着順・カーソルページング）---
  let cursor = null;
  for (let page = 0; page < FEED_PAGES; page += 1) {
    const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const res = get(`${API}/recipes?feed=all&limit=${PAGE_SIZE}${query}`, headers, tags("feed"));
    const ok = check(res, { "feed 200": (r) => r.status === 200 }, tags("feed"));
    if (!ok) return;
    const body = res.json();
    for (const item of body.items) recipeIds.push(item.id);
    // API は CamelModel で camelCase に変換して返す（openapi/openapi.json も `nextCursor`）。
    cursor = body.nextCursor;
    if (!cursor) break;
  }

  // --- 検索（材料名。語彙はシードと同じなので必ずヒットする）---
  const term = pick(vocabulary.ingredients);
  const search = get(
    `${API}/recipes?feed=all&limit=${PAGE_SIZE}&q=${encodeURIComponent(term)}`,
    headers,
    tags("search"),
  );
  check(
    search,
    {
      "search 200": (r) => r.status === 200,
      "search にヒットがある": (r) => r.status === 200 && r.json("items").length > 0,
    },
    tags("search"),
  );

  // --- 詳細（フィードで見えたレシピから 1 件）---
  if (recipeIds.length > 0) {
    const detail = get(`${API}/recipes/${pick(recipeIds)}`, headers, tags("detail"));
    check(detail, { "detail 200": (r) => r.status === 200 }, tags("detail"));
  }

  sleep(THINK_TIME);
}
