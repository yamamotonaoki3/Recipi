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
