/**
 * Web（Chromium）E2E: GitHub Release更新検出・通知（Issue #318）。
 *
 * GitHub Release APIをモックし、新版検出時の3ボタン表示・「後で」の
 * 同一起動中の抑制を検証する。実際のGitHub APIへは接続しない。
 */
import { test, expect } from "./console-guard";

const RELEASES_API_PATTERN = "**/repos/*/*/releases/latest";

test("新Releaseを検出すると通知バナーに3つの操作が表示される", async ({ page }) => {
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
  await expect(page.getByTestId("update-notification-banner-update")).toBeVisible();
  await expect(page.getByTestId("update-notification-banner-view-release")).toBeVisible();
  await expect(page.getByTestId("update-notification-banner-dismiss")).toBeVisible();
});

test("新Releaseが無ければ通知バナーは表示されない", async ({ page }) => {
  // 404（Releaseが1つも無い）は console-guard.ts の BUILTIN_ALLOWANCES で許可済み。
  await page.route(RELEASES_API_PATTERN, (route) => route.fulfill({ status: 404 }));

  await page.goto("/login");
  await expect(page.getByTestId("login-submit")).toBeVisible();
  await expect(page.getByTestId("update-notification-banner")).toHaveCount(0);
});

test("「後で」を押すとリロードするまで同一セッション内では再表示しない", async ({ page }) => {
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
  await page.getByTestId("update-notification-banner-dismiss").click();
  await expect(page.getByTestId("update-notification-banner")).toHaveCount(0);

  // 同一SPAセッション内で画面遷移しても再表示されない。
  await page.getByText("新規登録").click();
  await expect(page.getByTestId("signup-email")).toBeVisible();
  await expect(page.getByTestId("update-notification-banner")).toHaveCount(0);
});
