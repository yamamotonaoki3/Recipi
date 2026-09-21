/** Web E2E: アカウント設定からメールアドレスを変更する（Issue #243）。 */
import { expect, test } from "./console-guard";
import { PASSWORD, makeRunId, signUp, visibleText } from "./helpers";

const EMAIL_PATH = "/api/v1/users/me/email";

test("メール確認・再認証エラーを経てメールを変更し、プロフィール表示を更新する", async ({
  page,
  consoleGuard,
}) => {
  consoleGuard.allow({
    kind: "console",
    message: /status of 403 \(Forbidden\)/,
    url: /\/api\/v1\/users\/me\/email$/,
    reason: "現在のパスワードを間違えたときの403 REAUTH_FAILED（画面で確認する）",
  });

  const oldEmail = `e2euser_email_${makeRunId()}@example.com`;
  const newEmail = `e2euser_email_new_${makeRunId()}@example.com`;
  await signUp(page, oldEmail, "E2E Email UI");
  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-account-settings").last().click();
  const field = (id: string) =>
    page
      .getByTestId(
        id === "email" || id === "email-confirm"
          ? `account-settings-${id}`
          : `account-settings-email-${id}`,
      )
      .last();
  await expect(field("current-password")).toBeVisible({ timeout: 15_000 });

  let calls = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === EMAIL_PATH) calls += 1;
  });

  await field("current-password").fill(PASSWORD);
  await field("email").fill(newEmail);
  await field("email-confirm").fill(`${newEmail}.mismatch`);
  await field("submit").click();
  await expect(visibleText(page, "メールアドレスが一致しません")).toBeVisible();
  expect(calls).toBe(0);

  await field("email-confirm").fill(newEmail);
  await field("current-password").fill("WrongPass1!");
  await field("submit").click();
  const [rejected] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === EMAIL_PATH),
    page.getByTestId("account-settings-email-dialog-confirm").last().click(),
  ]);
  expect(rejected.status()).toBe(403);
  await expect(visibleText(page, "現在のパスワードが正しくありません")).toBeVisible();
  await expect(page.getByTestId("login-email")).toHaveCount(0);

  await field("current-password").fill(PASSWORD);
  await field("submit").click();
  const [accepted] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === EMAIL_PATH),
    page.getByTestId("account-settings-email-dialog-confirm").last().click(),
  ]);
  expect(accepted.status()).toBe(200);
  await expect(visibleText(page, "メールアドレスを変更しました")).toBeVisible({ timeout: 15_000 });
  expect(calls).toBe(2);

  await page.getByTestId("account-settings-back").last().click();
  await page.getByTestId("my-page-profile-edit").last().click();
  await expect(page.getByTestId("profile-edit-email").last()).toHaveText(newEmail, {
    timeout: 15_000,
  });
});

test("保持しないでログイン → 再読み込み → メール変更しても長期 Cookie に切り替わらない（Issue #275）", async ({
  page,
}) => {
  const email = `e2euser_email_keep_${makeRunId()}@example.com`;
  const newEmail = `e2euser_email_keep_new_${makeRunId()}@example.com`;
  // 登録直後のセッションは「保持しない」（ブラウザを閉じると消えるセッション Cookie）。
  await signUp(page, email, "E2E Remember Off");

  // 再読み込み → Cookie からセッションを復元。ここで選択が失われると true 扱いになる。
  await page.reload();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-account-settings").last().click();
  const field = (id: string) => page.getByTestId(`account-settings-${id}`).last();
  await expect(field("email-current-password")).toBeVisible({ timeout: 15_000 });
  await field("email-current-password").fill(PASSWORD);
  await field("email").fill(newEmail);
  await field("email-confirm").fill(newEmail);
  await field("email-submit").click();

  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === EMAIL_PATH),
    page.getByTestId("account-settings-email-dialog-confirm").last().click(),
  ]);
  expect(response.status()).toBe(200);
  // サーバーは送られた rememberMe で Cookie を作る。保持しない選択が守られていれば、有効期限の無い
  // セッション Cookie が返る（true が送られていれば Max-Age が付く）。
  const setCookie = (await response.headersArray())
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .join("\n");
  expect(setCookie).toContain("recipi_refresh_token=");
  expect(setCookie).not.toMatch(/max-age|expires/i);
});

test("応答が届かなかったときは変更の可能性と再ログインを案内し、実際に新しいアドレスで入れる（Issue #276）", async ({
  page,
  consoleGuard,
}) => {
  consoleGuard.allow({
    kind: "console",
    message: /Failed to load resource: net::ERR_FAILED/,
    url: /\/api\/v1\/users\/me\/email$/,
    reason: "応答を意図的に捨てて『サーバーだけ変更済み』の状況を作っている",
  });

  const oldEmail = `e2euser_email_lost_${makeRunId()}@example.com`;
  const newEmail = `e2euser_email_lost_new_${makeRunId()}@example.com`;
  await signUp(page, oldEmail, "E2E Lost Response");

  // サーバーには届いて処理されるが、ブラウザは応答を受け取れない。
  let calls = 0;
  await page.route(`**${EMAIL_PATH}`, async (route) => {
    calls += 1;
    await route.fetch();
    await route.abort("failed");
  });

  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-account-settings").last().click();
  const field = (id: string) => page.getByTestId(`account-settings-${id}`).last();
  await expect(field("email-current-password")).toBeVisible({ timeout: 15_000 });
  await field("email-current-password").fill(PASSWORD);
  await field("email").fill(newEmail);
  await field("email-confirm").fill(newEmail);
  await field("email-submit").click();
  await page.getByTestId("account-settings-email-dialog-confirm").last().click();

  await expect(page.getByText(/変更されている可能性/).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/新しいメールアドレスでログインし直して/).last()).toBeVisible();
  await expect(page.getByText("通信エラー。もう一度お試しください")).toHaveCount(0);
  expect(calls).toBe(1); // 自動で再送していない

  // 案内どおり、サーバー側では変更済み: 新しいアドレスでログインできる。
  await page.unroute(`**${EMAIL_PATH}`);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(newEmail);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });
});
