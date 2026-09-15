// 性能テストのログインとトークン管理（Issue #145）。
//
// ## 方針
// - 測りたいのは「閲覧」の速さ。ログインは Argon2id（わざと重いハッシュ）を使うので、
//   毎回ログインさせると認証の重さばかり測ってしまう。そこで setup() でまとめて
//   ログインし、得たトークンを VU（仮想ユーザー）に配る。
// - アクセストークンは 15 分で切れる（backend の ACCESS_TOKEN_TTL_MINUTES）。
//   15 分を超えるテスト（ストレス等）でも 401 にならないよう、発行から
//   REFRESH_AFTER_MS を過ぎたら VU が自分でログインし直す。
import http from "k6/http";
import { check, fail } from "k6";

import { API, PASSWORD, USER_COUNT } from "./config.js";

// 15 分の期限より十分前（10 分）で取り直す。
const REFRESH_AFTER_MS = 10 * 60 * 1000;

/** seed_perf.py の perf_email と同じ規則（perfuser_001@example.com）。 */
export function perfEmail(n) {
  return `perfuser_${String(n).padStart(3, "0")}@example.com`;
}

/** VU 番号（1 始まり）から、その VU が使うユーザー番号を決める。 */
export function userNumberForVu(vu, userCount = USER_COUNT) {
  return ((vu - 1) % userCount) + 1;
}

/** ログインしてアクセストークンを返す。失敗したらテストを止める（原因が分かるように）。 */
export function login(email) {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "login" },
  });
  const ok = check(res, { "login 200": (r) => r.status === 200 });
  if (!ok) {
    fail(`${email} でログインできません（${res.status}）。seed_perf の --users と k6 の -e PERF_USERS を同じ値にしてください。seed_perf を実行したか確認してください`);
  }
  return res.json("accessToken");
}

/**
 * setup() から呼ぶ。VU 数ぶん（ユーザー数が上限）ログインして、トークンの一覧を返す。
 * 戻り値は各 VU の default 関数に `data` として渡る。
 */
export function loginAll(vus) {
  const tokens = [];
  for (let n = 1; n <= Math.min(vus, USER_COUNT); n += 1) {
    tokens.push(login(perfEmail(n)));
  }
  return { tokens, issuedAt: Date.now() };
}

// VU ごとの状態（k6 は VU ごとに JS の実行環境が別なので、モジュール変数は VU 専用）。
let myToken = null;
let myIssuedAt = 0;

/** この VU が使う Authorization ヘッダー。期限が近ければログインし直す。 */
export function authHeaders(data) {
  // 実際に取得できたトークン数を使うと、--users を減らした場合も存在するユーザーだけを選べる。
  const n = userNumberForVu(__VU, data.tokens.length);
  if (myToken === null) {
    myToken = data.tokens[n - 1] ?? null;
    myIssuedAt = data.issuedAt;
  }
  if (myToken === null || Date.now() - myIssuedAt > REFRESH_AFTER_MS) {
    myToken = login(perfEmail(n));
    myIssuedAt = Date.now();
  }
  return { Authorization: `Bearer ${myToken}` };
}
