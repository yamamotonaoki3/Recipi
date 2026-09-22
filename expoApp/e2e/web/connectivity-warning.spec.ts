/**
 * Web（Chromium）E2E: backend接続不能警告（Issue #318）。
 *
 * backend停止（全API呼び出し失敗）を模擬し、警告ダイアログの表示・
 * 「後で確認」後のバー表示・「再試行」での復旧・API復旧後の解除を検証する。
 */
import { test, expect } from "./console-guard";

test("backend停止時に警告ダイアログが表示され、「後で確認」でバーに切り替わる", async ({
  page,
  consoleGuard,
}) => {
  consoleGuard.allow({
    kind: "console",
    message: /ERR_CONNECTION_REFUSED|Failed to load resource/,
    url: /\/api\/v1\/|\/healthz/,
    reason:
      "backend停止を意図的に再現しているため（Issue #318）。Release未検出404はBUILTIN_ALLOWANCESで許可済み",
  });
  // GitHub Release APIは正常応答させ、backendだけ停止させる。
  await page.route("**/repos/*/*/releases/latest", (route) => route.fulfill({ status: 404 }));
  await page.route("**/api/v1/**", (route) => route.abort("connectionrefused"));
  await page.route("**/healthz", (route) => route.abort("connectionrefused"));

  await page.goto("/login");

  await expect(page.getByTestId("connectivity-warning-dialog")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("connectivity-warning-dialog-dismiss").click();
  await expect(page.getByTestId("connectivity-warning-dialog")).toHaveCount(0);
  await expect(page.getByTestId("connectivity-warning-bar")).toBeVisible();
});

test("backend復旧後に「再試行」を押すと警告が解除される", async ({ page, consoleGuard }) => {
  consoleGuard.allow({
    kind: "console",
    message: /ERR_CONNECTION_REFUSED|Failed to load resource/,
    url: /\/api\/v1\/|\/healthz/,
    reason:
      "backend停止からの復旧を意図的に再現しているため（Issue #318）。Release未検出404はBUILTIN_ALLOWANCESで許可済み",
  });
  await page.route("**/repos/*/*/releases/latest", (route) => route.fulfill({ status: 404 }));

  let backendDown = true;
  await page.route("**/api/v1/**", (route) => {
    if (backendDown) return route.abort("connectionrefused");
    return route.continue();
  });
  await page.route("**/healthz", (route) => {
    if (backendDown) return route.abort("connectionrefused");
    return route.continue();
  });

  await page.goto("/login");
  await expect(page.getByTestId("connectivity-warning-dialog")).toBeVisible({ timeout: 10_000 });

  // backendが復旧したことにする。
  backendDown = false;
  await page.getByTestId("connectivity-warning-dialog-retry").click();

  await expect(page.getByTestId("connectivity-warning-dialog")).toHaveCount(0, {
    timeout: 10_000,
  });
});
