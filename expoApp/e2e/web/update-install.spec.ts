/**
 * Web（Chromium）E2E: 未署名インストーラーへの導線（Issue #319）。
 *
 * GitHub Release APIをモックし、「更新する」→インストール案内ダイアログ表示
 * →OS警告文言の確認→キャンセル時に何も起きないこと、を検証する。
 * 実際のダウンロード・インストールはE2Eでは検証できない（UI導線のみ）。
 */
import { test, expect } from "./console-guard";

const RELEASES_API_PATTERN = "**/repos/*/*/releases/latest";

test("「更新する」でインストール案内ダイアログが表示され、キャンセルで閉じる", async ({ page }) => {
  await page.route(RELEASES_API_PATTERN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tag_name: "v999.0.0",
        name: "v999.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/releases/tag/v999.0.0",
        assets: [],
      }),
    }),
  );

  await page.goto("/login");
  await expect(page.getByTestId("update-notification-banner")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("update-notification-banner-update").click();
  await expect(page.getByTestId("install-guide-dialog")).toBeVisible();
  // 未署名配布・OS確認の注意喚起が含まれること。
  await expect(page.getByTestId("install-guide-dialog")).toContainText("未署名");
  await expect(page.getByTestId("install-guide-dialog")).toContainText("発行元不明");

  await page.getByTestId("install-guide-dialog-cancel").click();
  await expect(page.getByTestId("install-guide-dialog")).toHaveCount(0);
});

test("アプリ情報画面の「更新を確認」からも「更新する」導線が使える", async ({ page }) => {
  await page.route(RELEASES_API_PATTERN, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tag_name: "v999.0.0",
        name: "v999.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/releases/tag/v999.0.0",
        assets: [],
      }),
    }),
  );

  await page.goto("/login");
  await page.getByText("アプリ情報").click();
  await page.getByTestId("app-info-check-update").click();
  await expect(page.getByTestId("app-info-install-update")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("app-info-install-update").click();
  await expect(page.getByTestId("install-guide-dialog")).toBeVisible();
});
