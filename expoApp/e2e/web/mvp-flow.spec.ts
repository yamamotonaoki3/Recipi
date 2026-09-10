/**
 * Web（Chromium）E2E: MVP 通しシナリオ（Issue #42 の受け入れ基準）。
 *
 * サインアップ → ＋ でレシピ作成（公開）→ ホーム「全体」に出る → 検索でヒット
 * → カードタップで詳細（＝閲覧記録）→ 履歴 destination に出る → ログアウト。
 *
 * Phase 0〜4（MVP ライン）が通しで動くことを 1 本で担保する。
 * テストデータはグローバル CLAUDE.md の規約どおり @example.com ＋ e2euser_ プレフィックス。
 *
 * 注: Expo Router の web スタックは遷移元の画面を DOM に残す（重ねて描画する）。
 * 同じ testID が複数マッチするので、最前面（＝最後にマウントされた画面）を見る
 * `.last()` を使う。
 */
import { test, expect } from "@playwright/test";

// 検索でこのレシピだけがヒットするよう、他のテストと重ならない語を材料名に使う。
const UNIQUE_INGREDIENT = "ズッキーニ";
const RECIPE_TITLE = "MVP通しレシピ";

test("サインアップ → 作成 → ホーム → 検索 → 詳細 → 履歴 → ログアウト", async ({ page }) => {
  // --- サインアップして自動ログイン ---
  await page.goto("/login");
  await page.getByText("新規登録").click();
  await page.getByTestId("signup-email").fill("e2euser_mvp@example.com");
  await page.getByTestId("signup-password").fill("TestPass123!");
  await page.getByTestId("signup-password-confirm").fill("TestPass123!");
  await page.getByTestId("signup-display-name").fill("E2E MVP User");
  await page.getByTestId("signup-security-question").fill("好きな食べ物は？");
  await page.getByTestId("signup-security-answer").fill("ラーメン");
  await page.getByTestId("signup-submit").click();

  // ホーム（5 destination のシェル）に着地する。
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });

  // --- ＋ から公開レシピを作成 ---
  await page.getByTestId("nav-create").last().click();
  await expect(page.getByTestId("editor-title")).toBeVisible();
  await page.getByTestId("editor-title").fill(RECIPE_TITLE);
  await page.getByTestId("g0-i0-name").fill(UNIQUE_INGREDIENT);
  await page.getByTestId("g0-i0-quantity").fill("1");
  await page.getByTestId("step-0-body").fill("材料を切って炒める");
  // フィード（feed=all）は公開レシピしか返さないので、公開に切り替える。
  await page.getByTestId("editor-is-public").click();
  await page.getByTestId("editor-save").click();

  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(RECIPE_TITLE, {
    timeout: 15_000,
  });

  // --- ホーム「全体」に新着で出る ---
  // 詳細からホームへ戻る。ここは「既に選択中の destination を押す」ケースで、
  // ホームのスタックが根まで戻ることを確かめたい。詳細画面にもレシピ名が
  // 出ているため、名前だけを見ると**詳細に留まっていても通ってしまう**ので、
  // 先にホーム固有の要素（検索窓）が見えることを確認する。
  await page.getByTestId("nav-home").last().click();
  await expect(page.getByTestId("home-search-input").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("recipe-detail-title")).toHaveCount(0);
  await expect(page.getByText(RECIPE_TITLE).last()).toBeVisible({ timeout: 15_000 });

  // --- 検索（材料名でヒットする。features/search.md）---
  await page.getByTestId("home-search-input").last().fill(UNIQUE_INGREDIENT);
  await page.getByTestId("home-search-input").last().press("Enter");
  await expect(page.getByTestId("home-search-chip").last()).toBeVisible();
  const card = page.getByText(RECIPE_TITLE).last();
  await expect(card).toBeVisible({ timeout: 15_000 });

  // --- Esc で検索をクリアできる（home.md §7 のデスクトップ操作）---
  // ここは**実ブラウザでしか確かめられない**。Escape では DOM の `keypress` が
  // 発火しないため、合成イベントを使う単体テストでは実挙動を再現できない
  // （react-native-web の `onKeyPress` は `keypress` 相当）。
  await page.getByTestId("home-search-input").last().press("Escape");
  await expect(page.getByTestId("home-search-chip")).toHaveCount(0);
  await expect(page.getByTestId("home-search-input").last()).toHaveValue("");

  // 検索し直してから詳細へ進む。ここは**検索ボタン**で確定する
  // （確定の経路は Enter とボタンの 2 つあり、両方を通しで確かめる。
  // Android は IME の都合でボタンしか使えない。Issue #74）。
  await page.getByTestId("home-search-input").last().fill(UNIQUE_INGREDIENT);
  await page.getByTestId("home-search-submit").last().click();
  await expect(page.getByTestId("home-search-chip").last()).toBeVisible();

  // --- カードタップで詳細（ここで POST /recipes/{id}/view が飛ぶ）---
  await card.click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(RECIPE_TITLE, {
    timeout: 15_000,
  });

  // --- 履歴 destination に出る（サーバー保存の閲覧履歴）---
  await page.getByTestId("nav-history").last().click();
  await expect(page.getByTestId("history-clear").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(RECIPE_TITLE).last()).toBeVisible({ timeout: 15_000 });

  // --- 履歴の消去（確認ダイアログ → 空状態）---
  await page.getByTestId("history-clear").last().click();
  await page.getByTestId("history-clear-dialog-confirm").last().click();
  await expect(page.getByTestId("history-empty").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("history-cleared-snackbar").last()).toBeVisible();

  // --- マイページからログアウト ---
  await page.getByTestId("nav-my-page").last().click();
  await expect(page.getByTestId("my-page-display-name").last()).toHaveText("E2E MVP User");
  await page.getByTestId("my-page-logout").last().click();
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 15_000 });
});
