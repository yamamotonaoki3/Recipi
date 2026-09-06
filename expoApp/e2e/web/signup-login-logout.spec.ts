/**
 * Web（Chromium）E2E: 新規登録 → 自動ログイン確認 → ログアウト → 再ログイン
 * （Issue #36）。
 *
 * テストデータはグローバル CLAUDE.md の規約に従い、実在しないメール
 * アドレス（@example.com）＋ e2euser_ プレフィックスを使う。CI では
 * postgres コンテナを毎回作り直すため固定値で問題ない。
 */
import { test, expect } from "@playwright/test";

test("signup → 自動ログイン確認 → logout → 再ログイン", async ({ page }) => {
  await page.goto("/login");

  // 起動後は splash → 未ログインなのでログイン画面に着地する。
  // そこから「新規登録」リンクでサインアップ画面へ移動する。
  await page.getByText("新規登録").click();

  await page.getByTestId("signup-email").fill("e2euser_002@example.com");
  await page.getByTestId("signup-password").fill("TestPass123!");
  await page.getByTestId("signup-password-confirm").fill("TestPass123!");
  await page.getByTestId("signup-display-name").fill("E2EUser B");
  await page.getByTestId("signup-security-question").fill("好きな食べ物は？");
  await page.getByTestId("signup-security-answer").fill("ラーメン");
  await page.getByTestId("signup-submit").click();

  // 登録成功 → 自動ログイン状態でホームに遷移し、
  // 表示名入りのウェルカムメッセージが出ることを確認する。
  await expect(page.getByText("ようこそ、E2EUser B さん")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("home-logout").click();

  // ログアウト後は認可ゲート（useProtectedRoute）によりログイン画面へ戻される。
  await expect(page.getByTestId("login-email")).toBeVisible();

  await page.getByTestId("login-email").fill("e2euser_002@example.com");
  await page.getByTestId("login-password").fill("TestPass123!");
  await page.getByTestId("login-submit").click();

  await expect(page.getByText("ようこそ、E2EUser B さん")).toBeVisible({ timeout: 15_000 });
});
