/**
 * Web E2E の共通手順（Issue #135 で新しい spec のために切り出した）。
 *
 * 既存の spec（signup-login-logout / recipe-crud / mvp-flow）は自前で同じ手順を
 * 書いているが、差分を小さく保つためそのままにしている。
 *
 * テストデータはグローバル CLAUDE.md の規約どおり `e2euser_` ＋ `@example.com`。
 * メールの末尾を `_<runId>@example.com` にしておくと、後始末スクリプト
 * （backend/scripts/cleanup_e2e.py の `--run-id`）で 1 回の実行分だけを消せる。
 *
 * 注: Expo Router の web スタックは遷移元の画面を DOM に残すので、同じ testID が
 * 複数マッチする。最前面（＝最後にマウントされた画面）を見る `.last()` を使う。
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "TestPass123!";

/**
 * 画面に**見えている**テキストだけを取る。
 *
 * `.last()` だけでは足りない場面がある。ホームはタブの一覧を消さずに隠しておくので
 * （home.md §5）、「フォロー」タブを開いても「全体」タブの検索結果が DOM に残り、
 * 同じタイトルが複数ヒットして、隠れている方を掴んでしまう（Issue #135 で実際に発生）。
 */
export function visibleText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

/** 1 回の実行を表す ID（英小文字・数字・ハイフンだけ。cleanup の `--run-id` と同じ規則）。 */
export function makeRunId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/** サインアップして、自動ログインでホームに着地するまで待つ。 */
export async function signUp(page: Page, email: string, displayName: string): Promise<void> {
  await page.goto("/login");
  await page.getByText("新規登録").click();
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-password-confirm").fill(PASSWORD);
  await page.getByTestId("signup-display-name").fill(displayName);
  await page.getByTestId("signup-security-question").fill("好きな食べ物は？");
  await page.getByTestId("signup-security-answer").fill("ラーメン");
  await page.getByTestId("signup-submit").click();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });
}

/** ログイン画面から入り、ホームに着地するまで待つ。 */
export async function logIn(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });
}

/** マイページからログアウトし、ログイン画面に戻るまで待つ。 */
export async function logOut(page: Page): Promise<void> {
  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-logout").last().click();
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 15_000 });
}

/** ＋ から公開レシピを作り、詳細画面に着くまで待つ。 */
export async function createPublicRecipe(
  page: Page,
  title: string,
  ingredient: string,
): Promise<void> {
  await page.getByTestId("nav-create").last().click();
  await expect(page.getByTestId("editor-title")).toBeVisible();
  await page.getByTestId("editor-title").fill(title);
  await page.getByTestId("g0-i0-name").fill(ingredient);
  await page.getByTestId("g0-i0-quantity").fill("1");
  await page.getByTestId("step-0-body").fill("[E2E_TEST] 材料を切って炒める");
  // フィード・検索は公開レシピしか返さないので、公開に切り替える。
  await page.getByTestId("editor-is-public").click();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(title, {
    timeout: 15_000,
  });
}

/** ホームの検索に語を入れ、検索ボタンで確定する。 */
export async function searchHome(page: Page, query: string): Promise<void> {
  await page.getByTestId("nav-home").last().click();
  await expect(page.getByTestId("home-search-input").last()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("home-search-input").last().fill(query);
  await page.getByTestId("home-search-submit").last().click();
  await expect(page.getByTestId("home-search-chip").last()).toBeVisible();
}
