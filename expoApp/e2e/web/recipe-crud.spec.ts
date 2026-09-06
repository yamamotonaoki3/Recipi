/**
 * Web（Chromium）E2E: レシピ作成 → 一覧に出る → 詳細を開く → 編集 → 保存
 * （Issue #38 受け入れ基準のフロー）。
 *
 * テストデータはグローバル CLAUDE.md の規約どおり @example.com ＋
 * e2euser_ プレフィックス。CI は postgres コンテナを毎回作り直すので固定値でよい。
 *
 * 注: Expo Router の web スタックは遷移元の画面を DOM に残す（重ねて描画する）。
 * 同じ testID / テキストが複数マッチするので、最前面（＝最後にマウントされた
 * 画面）を見る `.last()` を使う。
 */
import { test, expect } from "@playwright/test";

const detailTitle = (page: import("@playwright/test").Page) =>
  page.getByTestId("recipe-detail-title").last();

test("レシピ作成 → 一覧 → 詳細 → 編集 → 保存", async ({ page }) => {
  // --- サインアップして自動ログイン ---
  await page.goto("/login");
  await page.getByText("新規登録").click();
  await page.getByTestId("signup-email").fill("e2euser_recipe@example.com");
  await page.getByTestId("signup-password").fill("TestPass123!");
  await page.getByTestId("signup-password-confirm").fill("TestPass123!");
  await page.getByTestId("signup-display-name").fill("E2E Recipe User");
  await page.getByTestId("signup-security-question").fill("好きな食べ物は？");
  await page.getByTestId("signup-security-answer").fill("ラーメン");
  await page.getByTestId("signup-submit").click();
  await expect(page.getByText("ようこそ、E2E Recipe User さん")).toBeVisible({ timeout: 15_000 });

  // --- レシピを作成 ---
  await page.getByTestId("home-link-new-recipe").click();
  await expect(page.getByTestId("editor-title")).toBeVisible();
  await page.getByTestId("editor-title").fill("E2Eテストレシピ");
  await page.getByTestId("g0-i0-name").fill("じゃがいも");
  await page.getByTestId("g0-i0-quantity").fill("3");
  await page.getByTestId("step-0-body").fill("材料を切って煮る");
  await page.getByTestId("editor-save").click();

  // 保存成功 → レシピ詳細へ遷移し、タイトルと材料が表示される
  await expect(detailTitle(page)).toHaveText("E2Eテストレシピ", { timeout: 15_000 });
  await expect(page.getByText("じゃがいも").last()).toBeVisible();

  // --- ホームに戻って自分のレシピ一覧に出ることを確認 ---
  await page.getByTestId("recipe-detail-header-back").last().click();
  await page.getByTestId("home-link-my-recipes").click();
  const card = page.getByText("E2Eテストレシピ").last();
  await expect(card).toBeVisible({ timeout: 15_000 });

  // --- カードから詳細 → 編集 ---
  await card.click();
  await expect(detailTitle(page)).toHaveText("E2Eテストレシピ", { timeout: 15_000 });
  await page.getByTestId("recipe-detail-edit").last().click();

  await expect(page.getByTestId("editor-title").last()).toHaveValue("E2Eテストレシピ");
  await page.getByTestId("editor-title").last().fill("E2Eテストレシピ（改）");
  await page.getByTestId("editor-save").last().click();

  // 編集内容が詳細に反映される
  await expect(detailTitle(page)).toHaveText("E2Eテストレシピ（改）", { timeout: 15_000 });
});
