/**
 * E2E（API 層）: メールアドレスの変更（Issue #241）。
 *
 * 画面は Issue #243 で作るので、ここでは `request` フィクスチャで実際に動いている
 * API を直接叩く。`security-question-api.spec.ts` と同じ考え方で、backend の
 * `TestClient` では確かめられないこと（ビルドしたコンテナに変更が入っているか、
 * 実 DB にマイグレーションが当たっているか、uvicorn を通した実際のステータス）を見る。
 *
 * ロジックの網羅（境界値・競合・チェーン・監査ログ）は
 * `backend/tests/test_email_change.py` が担当する。ここは契約の要点だけ。
 *
 * ## レート制限に注意
 *
 * 再認証は `reauth_attempts` で **IP 単位 20 回 / 直近 15 分**に制限され、
 * 秘密の質問の変更（#240）と枠を共有する。E2E は全部が同じ IP から走り、
 * テストの合間に記録を消す仕組みも無い。**ここで使う再認証は 2 回**（成功 1・重複 1）。
 * `security-question-api.spec.ts` の 2 回と合わせて 4 回で、上限には余裕があるが、
 * これ以上増やさないこと。
 */
import { expect, test } from "./console-guard";

import { PASSWORD, makeRunId } from "./helpers";

const API = process.env.E2E_API_BASE_URL ?? "http://localhost:8000";

async function signUp(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.post(`${API}/api/v1/auth/signup`, {
    data: {
      email,
      password: PASSWORD,
      displayName: "E2E Email",
      securityQuestion: "好きな食べ物は？",
      securityAnswer: "ラーメン",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).accessToken as string;
}

test("メールアドレスを変更 → 新しいアドレスでログインでき、古いアドレスでは通らない", async ({
  request,
}) => {
  const runId = makeRunId();
  const oldEmail = `e2euser_mail_${runId}@example.com`;
  const newEmail = `e2euser_mailnew_${runId}@example.com`;
  const accessToken = await signUp(request, oldEmail);

  const changed = await request.put(`${API}/api/v1/users/me/email`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { currentPassword: PASSWORD, email: newEmail, rememberMe: false },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  const body = await changed.json();
  // 呼び出し元は返ってきたトークンで継続できる（全セッションを作り直すため）。
  expect(body.accessToken).toBeTruthy();

  const withNew = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: newEmail, password: PASSWORD, rememberMe: false },
  });
  expect(withNew.status(), await withNew.text()).toBe(200);

  const withOld = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: oldEmail, password: PASSWORD, rememberMe: false },
  });
  expect(withOld.status(), await withOld.text()).toBe(401);
});

test("既に使われているアドレスへの変更は 409", async ({ request }) => {
  const runId = makeRunId();
  const takenEmail = `e2euser_mailtaken_${runId}@example.com`;
  const mineEmail = `e2euser_mailmine_${runId}@example.com`;
  await signUp(request, takenEmail);
  const accessToken = await signUp(request, mineEmail);

  const res = await request.put(`${API}/api/v1/users/me/email`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { currentPassword: PASSWORD, email: takenEmail, rememberMe: false },
  });

  expect(res.status(), await res.text()).toBe(409);
});
