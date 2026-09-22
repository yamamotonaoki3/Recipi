/**
 * README用デモGIFの元動画を撮影するスクリプト（Playwrightを直接使用）。
 *
 * 既存のWeb E2E（e2e/web/）とは目的が異なる（失敗検知・コンソール監視では
 * なく、見た目の良いデモ操作を録画すること）ため、testランナーを介さず
 * 素のPlaywright APIで一回限り実行する。
 *
 * 前提: ローカルデモ環境が起動済みであること（README「すぐ試す: ローカルデモ」参照）。
 *   - backend: APP_ENV=demo で uvicorn 起動
 *   - frontend: 起動したbackendのURLをEXPO_PUBLIC_API_BASE_URLに設定して npm run web
 *   - backendのポートが開発用（8000）と衝突する場合は、別ポートで起動し
 *     DEMO_BASE_URL環境変数でfrontendのURLを指定する。
 *
 * 使い方: npx tsx scripts/demo/record-demo.ts
 */
import { chromium, devices } from "@playwright/test";
import path from "node:path";

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:8081";
const OUTPUT_DIR = path.join(__dirname, "output");
const DEMO_EMAIL = "demo.chef@example.com";
const DEMO_PASSWORD = "DemoPass123!";
const RECIPE_TITLE = "デモ用オムライス";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 14"],
    recordVideo: { dir: OUTPUT_DIR, size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();

  try {
    // --- ログイン ---
    await page.goto(`${BASE_URL}/login`);
    await page.getByTestId("login-email").fill(DEMO_EMAIL);
    await page.getByTestId("login-password").fill(DEMO_PASSWORD);
    await page.waitForTimeout(500);
    await page.getByTestId("login-submit").click();
    await page.getByTestId("home-logo").last().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    // --- レシピ一覧（ホームフィード）をスクロールして見せる ---
    await page.getByTestId("home-feed-list").last().hover();
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(1000);

    // --- 検索 ---
    await page.getByTestId("home-search-input").last().click();
    await page.getByTestId("home-search-input").last().pressSequentially("鶏", { delay: 120 });
    await page.waitForTimeout(500);
    await page.getByTestId("home-search-submit").last().click();
    await page.waitForTimeout(1500);

    // --- 検索結果から詳細へ ---
    const firstCard = page.getByTestId("home-search-chip").last();
    await firstCard.waitFor({ timeout: 20_000 });
    const resultCard = page.locator('[data-testid^="feed-recipe-"]').last();
    await resultCard.click();
    await page.getByTestId("recipe-detail-title").last().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2000);

    // --- 一覧に戻ってレシピ登録へ ---
    await page.getByTestId("recipe-detail-header-back").last().click();
    await page.waitForTimeout(800);
    await page.getByTestId("nav-create").last().click();
    await page.getByTestId("editor-title").last().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);

    await page.getByTestId("editor-title").last().pressSequentially(RECIPE_TITLE, { delay: 60 });
    await page.getByTestId("g0-i0-name").last().pressSequentially("卵", { delay: 60 });
    await page.getByTestId("g0-i0-quantity").last().pressSequentially("2", { delay: 60 });
    await page.getByTestId("step-0-body").last().pressSequentially("ケチャップライスを卵で包む", {
      delay: 40,
    });
    await page.waitForTimeout(800);
    await page.getByTestId("editor-is-public").last().click();
    await page.waitForTimeout(500);
    await page.getByTestId("editor-save").last().click();

    // --- 保存後、詳細に反映される様子を数秒映す ---
    await page.getByTestId("recipe-detail-title").last().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`録画完了。動画は ${OUTPUT_DIR} に保存されました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
