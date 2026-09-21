/**
 * Web（Chromium）E2E: パスワード再設定（Issue #149）。
 *
 * 端末 A でログインしたまま、端末 B（別のブラウザコンテキスト。Cookie を共有しない）で
 * パスワードを再設定し、次を確かめる（features/auth.md §7・screens/password-reset.md）。
 * - 未登録メールは「登録されていません」（現在の実装は 404。デコイ質問を採用したら直す。
 *   features/auth.md「既知の制約」）
 * - 新パスワードの確認不一致はクライアントで止め、API を呼ばない
 * - 答えの誤りは「入力内容を確認してください」
 * - 成功するとログイン画面にスナックバー「パスワードを再設定しました」
 * - 古いパスワードは拒否、新しいパスワードでログインできる
 * - 再設定前にログインしていた端末 A は、再読み込みでログイン画面に戻る
 *
 * 答えを続けて間違えたときのロック（429）は backend の tests/test_auth_password_reset.py で
 * 担保済み。E2E に入れると IP ごとの試行上限を毎回使うため入れない。1 回の実行での試行記録は
 * メールごとに最大 3 件（上限 5 件）で、CI の後始末（cleanup_e2e.py）が消す。
 */
import { expect, test } from "./console-guard";

import { PASSWORD, makeRunId, signUp } from "./helpers";

const NEW_PASSWORD = "NewTestPass456!";

test("パスワード再設定 → 新しいパスワードでログイン → 古い端末は再ログインが必要", async ({
  page,
  browser,
  consoleGuard,
}) => {
  // このテストが意図して起こす異常系（Issue #247 のコンソール監視で許可する）。
  consoleGuard.allow({
    kind: "console",
    message: /status of 404 \(Not Found\)/,
    url: /\/api\/v1\/auth\/password-reset\/request$/,
    reason: "未登録メールで再設定を始めると 404（下で「登録されていません」を確かめている）",
  });
  consoleGuard.allow({
    kind: "console",
    message: /status of 400 \(Bad Request\)/,
    url: /\/api\/v1\/auth\/password-reset\/confirm$/,
    reason: "答えを誤ると 400（下で「入力内容を確認してください」を確かめている）",
  });
  consoleGuard.allow({
    kind: "console",
    message: /status of 401 \(Unauthorized\)/,
    url: /\/api\/v1\/auth\/login$/,
    reason: "再設定後に古いパスワードでログインすると 401（拒否されることを確かめている）",
  });

  const runId = makeRunId();
  const email = `e2euser_reset_${runId}@example.com`;
  const unregistered = `e2euser_resetnone_${runId}@example.com`;

  // --- 端末 A: 登録してログインしたまま残す ---
  await signUp(page, email, "E2E Reset");

  // --- 端末 B: 別コンテキストで再設定する ---
  // newContext は playwright.config.ts の baseURL を引き継がないので明示する。
  const deviceB = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const b = await deviceB.newPage();
  // 自分で作ったページは自動では監視されないので、最初の goto の前に登録する（Issue #247）。
  consoleGuard.watch(b);
  try {
    await b.goto("/login");
    await b.getByText("パスワードをお忘れの方").click();
    await expect(b.getByTestId("password-reset-email")).toBeVisible({ timeout: 15_000 });

    // 未登録メール
    await b.getByTestId("password-reset-email").fill(unregistered);
    await b.getByTestId("password-reset-request-submit").click();
    await expect(b.getByText("このメールアドレスは登録されていません")).toBeVisible({
      timeout: 15_000,
    });

    // 登録済みメール → 登録時の質問が出る
    await b.getByTestId("password-reset-email").fill(email);
    await b.getByTestId("password-reset-request-submit").click();
    await expect(b.getByText("好きな食べ物は？")).toBeVisible({ timeout: 15_000 });

    // 確認不一致 → クライアントで止め、confirm を呼ばない
    let confirmCalls = 0;
    b.on("request", (req) => {
      if (req.url().endsWith("/api/v1/auth/password-reset/confirm")) confirmCalls += 1;
    });
    await b.getByTestId("password-reset-security-answer").fill("ラーメン");
    await b.getByTestId("password-reset-new-password").fill(NEW_PASSWORD);
    await b.getByTestId("password-reset-new-password-confirm").fill("Different1!");
    await b.getByTestId("password-reset-confirm-submit").click();
    await expect(b.getByText("パスワードが一致しません")).toBeVisible();
    expect(confirmCalls).toBe(0);

    // 答えの誤り
    await b.getByTestId("password-reset-security-answer").fill("うどん");
    await b.getByTestId("password-reset-new-password-confirm").fill(NEW_PASSWORD);
    await b.getByTestId("password-reset-confirm-submit").click();
    await expect(b.getByText("入力内容を確認してください")).toBeVisible({ timeout: 15_000 });

    // 正しい答え → ログイン画面にスナックバー
    await b.getByTestId("password-reset-security-answer").fill("ラーメン");
    await b.getByTestId("password-reset-confirm-submit").click();
    await expect(b.getByTestId("login-reset-success-snackbar")).toHaveText(
      "パスワードを再設定しました",
      { timeout: 15_000 },
    );
    // 再設定画面は `router.replace` でログイン画面へ移るので、最初に開いたログイン画面の上に
    // もう 1 枚ログイン画面が重なる（web スタックは前の画面を DOM に残す）。見えている方だけを取る。
    const shown = (testId: string) => b.getByTestId(testId).filter({ visible: true }).first();
    await expect(shown("login-email")).toBeVisible();

    // 古いパスワードは拒否、新しいパスワードでログインできる
    await shown("login-email").fill(email);
    await shown("login-password").fill(PASSWORD);
    await shown("login-submit").click();
    await expect(
      b.getByText("メールアドレスまたはパスワードが違います").filter({ visible: true }),
    ).toBeVisible({ timeout: 15_000 });
    await shown("login-password").fill(NEW_PASSWORD);
    await shown("login-submit").click();
    await expect(b.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });
  } finally {
    await deviceB.close();
  }

  // --- 端末 A: 再設定前のセッションは使えない ---
  // 再読み込みで Cookie のリフレッシュを試み、失効済みなので 401 → ログイン画面、の順に進む。
  // `load` はホームの画像（MinIO）の読み込みまで待つので、HTML の読み込みだけで先へ進む。
  // ログイン画面に戻ったことは次の expect が待つ。
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 15_000 });
});
