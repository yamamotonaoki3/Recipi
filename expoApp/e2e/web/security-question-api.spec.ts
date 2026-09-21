/**
 * E2E（API 層）: 秘密の質問・答えの変更（Issue #240）。
 *
 * ## なぜ画面を操作しないのか
 *
 * この機能は backend 先行で、変更用の画面は Issue #242 で作る。画面が無いので
 * Playwright でクリックする対象が無い。それでも **実際に動いている API コンテナ**
 * に対して検証しておく価値があるので、`request` フィクスチャで HTTP を直接叩く。
 *
 * backend の `tests/test_security_question_change.py` と重複して見えるが、通る経路が違う。
 * あちらは `TestClient`（アプリを同じプロセス内で呼ぶ）なので、次を確かめられない。
 *
 * - ビルドしたコンテナに、変更したコードが本当に入っているか
 * - 実 DB にマイグレーションが当たっているか
 * - uvicorn・ルーティング・エラーハンドラを通した実際のステータスコードと本文
 *
 * ここが落ちたときは「実装は正しいが配備が古い」「マイグレーション忘れ」を疑う。
 * ロジックそのものの網羅（境界値・競合・監査ログ）は backend のテストが担当する。
 *
 * ## レート制限に注意
 *
 * 再認証は `reauth_attempts` で **IP 単位 20 回 / 直近 15 分**に制限され、秘密の質問の
 * 変更とメールアドレスの変更で枠を共有する（`backend/app/services/credentials.py`）。
 * E2E は全部が同じ IP から走り、テストの合間に記録を消す仕組みも無い。
 * **ここで使う再認証は 2 回だけ**に抑えてある（成功 1 回・失敗 1 回）。増やすときは
 * 上限に近づいていないか確かめること（`password-reset.spec.ts` も同じ理由で
 * 429 の検証を backend 側に任せている）。
 */
import { expect, test } from "@playwright/test";

import { PASSWORD, makeRunId } from "./helpers";

// 画面ではなく API を直接見るので、Web の baseURL とは別に API の URL が要る。
// CI の e2e.yml は api を localhost:8000 に立てる。
const API = process.env.E2E_API_BASE_URL ?? "http://localhost:8000";

const OLD_QUESTION = "好きな食べ物は？";
const OLD_ANSWER = "ラーメン";
const NEW_QUESTION = "初めて飼ったペットの名前は？";
const NEW_ANSWER = "ポチ";
const NEW_PASSWORD = "NewTestPass456!";

test("秘密の質問を変更 → 新しい答えでリセットでき、古い答えでは通らない", async ({ request }) => {
  const email = `e2euser_secq_${makeRunId()}@example.com`;

  // --- 登録（アクセストークンを受け取る） ---
  const signup = await request.post(`${API}/api/v1/auth/signup`, {
    data: {
      email,
      password: PASSWORD,
      displayName: "E2E SecQ",
      securityQuestion: OLD_QUESTION,
      securityAnswer: OLD_ANSWER,
    },
  });
  expect(signup.status(), await signup.text()).toBe(201);
  const accessToken: string = (await signup.json()).accessToken;
  const auth = { Authorization: `Bearer ${accessToken}` };

  // --- 現パスワードが違うと 403 REAUTH_FAILED（401 ではない） ---
  // ここが 401 に戻ると、クライアント（src/api/client.ts）が「トークン切れ」と
  // 解釈してリフレッシュ → 再送 → セッション破棄まで進み、パスワードを
  // 打ち間違えただけの利用者がログアウトさせられる。契約として固定する。
  const wrong = await request.put(`${API}/api/v1/users/me/security-question`, {
    headers: auth,
    data: {
      currentPassword: "WrongPass1!",
      securityQuestion: NEW_QUESTION,
      securityAnswer: NEW_ANSWER,
    },
  });
  expect(wrong.status(), await wrong.text()).toBe(403);
  expect((await wrong.json()).error.code).toBe("REAUTH_FAILED");

  // --- 正しい現パスワードで変更できる ---
  const changed = await request.put(`${API}/api/v1/users/me/security-question`, {
    headers: auth,
    data: {
      currentPassword: PASSWORD,
      securityQuestion: NEW_QUESTION,
      securityAnswer: NEW_ANSWER,
    },
  });
  expect(changed.status(), await changed.text()).toBe(204);

  // --- リセットの入口が新しい質問文を返す ---
  const asked = await request.post(`${API}/api/v1/auth/password-reset/request`, {
    data: { email },
  });
  expect(asked.status(), await asked.text()).toBe(200);
  expect((await asked.json()).securityQuestion).toBe(NEW_QUESTION);

  // --- 古い答えでは通らない ---
  const withOld = await request.post(`${API}/api/v1/auth/password-reset/confirm`, {
    data: { email, securityAnswer: OLD_ANSWER, newPassword: NEW_PASSWORD },
  });
  expect(withOld.status(), await withOld.text()).toBe(400);

  // --- 新しい答えで通り、新しいパスワードでログインできる ---
  const withNew = await request.post(`${API}/api/v1/auth/password-reset/confirm`, {
    data: { email, securityAnswer: NEW_ANSWER, newPassword: NEW_PASSWORD },
  });
  expect(withNew.status(), await withNew.text()).toBe(204);

  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password: NEW_PASSWORD, rememberMe: false },
  });
  expect(login.status(), await login.text()).toBe(200);
});
