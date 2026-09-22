/**
 * Web（Chromium）E2E: アプリ情報画面（Issue #317）。
 *
 * ログイン画面から開ける・バージョンが出る・「リリース内容を見る」で正しいURLの
 * 新規タブが開く・バックエンド停止中でも表示できることを検証する。
 */
import { test, expect } from "./console-guard";

test("ログイン画面からアプリ情報を開き、バージョンとリリースリンクを確認する", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("アプリ情報").click();

  await expect(page.getByTestId("app-info-version")).toHaveText(/バージョン \d+\.\d+\.\d+/, {
    timeout: 10_000,
  });

  const [releasePage] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByTestId("app-info-view-release").click(),
  ]);
  // ロード完了までは待たず、ナビゲーション先のURLだけを確認する
  // （外部サイトの実際のロードに依存させない）。
  await releasePage.waitForURL(/github\.com\/.+\/releases/, { timeout: 15_000 });
  await releasePage.close();
});

test("バックエンドが停止していてもアプリ情報を表示できる（Issue #317）", async ({
  page,
  consoleGuard,
}) => {
  // このテストが意図して起こす異常系（backend停止の模擬）。
  consoleGuard.allow({
    kind: "console",
    message: /ERR_CONNECTION_REFUSED/,
    url: /\/api\/v1\//,
    reason:
      "backend停止中でもアプリ情報画面が表示できることを確かめるため、意図的に全API呼び出しを失敗させている",
  });
  // 全てのバックエンドAPI呼び出しを失敗させ、backend停止を模擬する。
  await page.route("**/api/v1/**", (route) => route.abort("connectionrefused"));

  await page.goto("/login");
  await page.getByText("アプリ情報").click();

  await expect(page.getByTestId("app-info-version")).toHaveText(/バージョン \d+\.\d+\.\d+/, {
    timeout: 10_000,
  });
  // 更新を確認ボタン（Stage1では非活性）・リリースボタンは表示されクラッシュしない。
  await expect(page.getByTestId("app-info-check-update")).toBeVisible();
  await expect(page.getByTestId("app-info-view-release")).toBeVisible();
});
