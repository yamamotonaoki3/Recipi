/**
 * Web（Chromium）E2E: アカウント設定で秘密の質問を変更する（Issue #242）。
 *
 * 画面から送った値が**実際に保存されて効いている**ところまで通す（変更後にパスワード再設定で
 * 新しい質問が出て、新しい答えで再設定でき、新しいパスワードでログインできる）。
 * 旧い答えの拒否や境界値・競合は backend のテストが担当する。
 *
 * ## 確かめる要点
 *
 * - 確認の答えが一致しなければ **API を呼ばない**
 * - 現在のパスワードを間違えると **403 `REAUTH_FAILED`** で、**ログアウトされない**
 *   （そのまま再ログインせずに次の変更が成功することで確かめる）
 *
 * ## レート制限
 *
 * 再認証は IP 単位 20 回 / 15 分で、メールアドレスの変更と枠を共有する。
 * **このテストで使う再認証は 2 回**（誤ったパスワード 1・成功 1）。
 */
import { expect, test } from "./console-guard";
import { PASSWORD, makeRunId, signUp, visibleText } from "./helpers";

const CHANGE_PATH = "/api/v1/users/me/security-question";
const NEW_QUESTION = "初めて飼ったペットの名前は？";
const NEW_ANSWER = "ポチ";
const NEW_PASSWORD = "NewTestPass456!";

test("秘密の質問を変更 → 新しい答えでパスワードを再設定できる", async ({
  page,
  browser,
  consoleGuard,
}) => {
  // 手順 3 で意図して起こす 403 だけを、このテストの中で許可する。
  consoleGuard.allow({
    kind: "console",
    message: /status of 403 \(Forbidden\)/,
    url: /\/api\/v1\/users\/me\/security-question$/,
    reason: "現在のパスワードを間違えたときの 403 REAUTH_FAILED（下で確かめている）",
  });

  const email = `e2euser_secq_${makeRunId()}@example.com`;
  await signUp(page, email, "E2E SecQ UI");

  // --- マイページ → アカウント設定 ---
  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-account-settings").last().click();
  const field = (id: string) => page.getByTestId(`account-settings-${id}`).last();
  await expect(field("current-password")).toBeVisible({ timeout: 15_000 });

  let changeCalls = 0;
  page.on("request", (req) => {
    if (req.method() === "PUT" && new URL(req.url()).pathname === CHANGE_PATH) changeCalls += 1;
  });

  async function fillForm(password: string, confirm: string) {
    await field("current-password").fill(password);
    await field("security-question").fill(NEW_QUESTION);
    await field("security-answer").fill(NEW_ANSWER);
    await field("security-answer-confirm").fill(confirm);
  }

  // --- 1. 確認の答えが一致しない → API を呼ばない ---
  await fillForm(PASSWORD, "タマ");
  await field("security-submit").click();
  await expect(visibleText(page, "答えが一致しません")).toBeVisible();
  expect(changeCalls).toBe(0);

  // --- 2. 現在のパスワード違い → 403 REAUTH_FAILED、ログアウトしない ---
  await fillForm("WrongPass1!", NEW_ANSWER);
  const [rejected] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === CHANGE_PATH),
    field("security-submit").click(),
  ]);
  expect(rejected.status()).toBe(403);
  expect((await rejected.json()).error.code).toBe("REAUTH_FAILED");
  await expect(visibleText(page, "現在のパスワードが正しくありません")).toBeVisible();
  // ログイン画面に飛ばされていない。
  await expect(page.getByTestId("login-email")).toHaveCount(0);

  // --- 3. 正しく入力 → 204。再ログインせずに成功する（＝ 2 でセッションが壊れていない） ---
  await fillForm(PASSWORD, NEW_ANSWER);
  const [accepted] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === CHANGE_PATH),
    field("security-submit").click(),
  ]);
  expect(accepted.status()).toBe(204);
  await expect(field("success")).toHaveText("秘密の質問を変更しました");
  for (const id of [
    "current-password",
    "security-question",
    "security-answer",
    "security-answer-confirm",
  ]) {
    await expect(field(id)).toHaveValue("");
  }
  expect(changeCalls).toBe(2);

  // --- 4. 変更が実際に効いている: 新しい質問が出て、新しい答えで再設定できる ---
  // 別のブラウザコンテキスト（ログインしていない端末）で再設定する。
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const b = await other.newPage();
  consoleGuard.watch(b);
  try {
    await b.goto("/login");
    await b.getByText("パスワードをお忘れの方").click();
    await b.getByTestId("password-reset-email").fill(email);
    await b.getByTestId("password-reset-request-submit").click();
    await expect(b.getByText(NEW_QUESTION)).toBeVisible({ timeout: 15_000 });

    await b.getByTestId("password-reset-security-answer").fill(NEW_ANSWER);
    await b.getByTestId("password-reset-new-password").fill(NEW_PASSWORD);
    await b.getByTestId("password-reset-new-password-confirm").fill(NEW_PASSWORD);
    await b.getByTestId("password-reset-confirm-submit").click();
    await expect(b.getByTestId("login-reset-success-snackbar")).toBeVisible({ timeout: 15_000 });

    // Web のスタックは前の画面を DOM に残すので、見えているログイン欄だけを使う。
    const shown = (id: string) => b.getByTestId(id).filter({ visible: true }).first();
    await shown("login-email").fill(email);
    await shown("login-password").fill(NEW_PASSWORD);
    await shown("login-submit").click();
    await expect(b.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });
  } finally {
    await other.close();
  }
});
