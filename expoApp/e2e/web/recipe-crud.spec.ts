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
import path from "node:path";

import { test, expect } from "@playwright/test";

type Page = import("@playwright/test").Page;

const detailTitle = (page: Page) => page.getByTestId("recipe-detail-title").last();

const FIXTURE_IMAGE = path.join(__dirname, "..", "fixtures", "test-image.png");

/**
 * 画像を 1 枚選ぶ（web の `expo-image-picker` 用）。
 *
 * web 実装は呼び出された瞬間に `<input type="file">` を DOM に足してクリックを
 * 発火する。**その input を後から掴んで `setInputFiles` する方式は使えない**:
 * クリックでブラウザのファイル選択ダイアログが実際に開き、Playwright は
 * `filechooser` の待ち受けが無いとそれを自動キャンセルする。キャンセルされると
 * expo-image-picker が input を DOM から即座に取り除くため、掴む前に消える。
 *
 * そこで「クリックする前から `filechooser` を待ち受け、開いたダイアログに
 * ファイルを渡す」という Playwright の正攻法を使う。
 */
async function pickImage(page: Page, pickTestId: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10_000 }),
    page.getByTestId(pickTestId).last().click(),
  ]);
  await chooser.setFiles(FIXTURE_IMAGE);
}

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
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });

  // --- レシピを作成 ---
  await page.getByTestId("nav-create").last().click();
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
  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-my-recipes").last().click();
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

/**
 * 画像アップロードのフルフロー（Issue #40）。
 *
 * Android E2E は端末のギャラリーが別アプリで OS 差により不安定なため
 * 表示確認のみに留めており、**「選ぶ → 上げる → 紐付く」の一連の経路を
 * 自動で担保しているのはこのテストだけ**。
 */
test("サムネイルと手順画像を付けて保存 → 詳細に表示される", async ({ page }) => {
  const email = `e2euser_image_${Date.now()}@example.com`;

  await page.goto("/login");
  await page.getByText("新規登録").click();
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-password").fill("TestPass123!");
  await page.getByTestId("signup-password-confirm").fill("TestPass123!");
  await page.getByTestId("signup-display-name").fill("E2E Image User");
  await page.getByTestId("signup-security-question").fill("好きな食べ物は？");
  await page.getByTestId("signup-security-answer").fill("ラーメン");
  await page.getByTestId("signup-submit").click();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("nav-create").last().click();
  await expect(page.getByTestId("editor-title")).toBeVisible();

  // 画像を選ぶ前はプレースホルダ。
  await expect(page.getByTestId("editor-thumbnail-placeholder").last()).toBeVisible();

  // サムネイルをアップロード。成功するとキーが入り「設定しました」に変わる
  // （表示 URL は保存後に詳細を取り直すまで分からないため）。
  await pickImage(page, "editor-thumbnail-pick");
  // アップロード成功でその場に選んだ画像が出る（`POST /images` が返す表示用 URL）。
  await expect(page.getByTestId("editor-thumbnail-preview").last()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("editor-title").fill("画像付きレシピ");
  await page.getByTestId("g0-i0-name").fill("じゃがいも");
  await page.getByTestId("step-0-body").fill("材料を切って煮る");

  // 手順 1 にも画像を付ける。
  await pickImage(page, "step-0-image-pick");
  await expect(page.getByTestId("step-0-image-preview").last()).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("editor-save").click();

  // 詳細でサムネイルと手順画像が実際に描画される（プレースホルダではない）。
  await expect(detailTitle(page)).toHaveText("画像付きレシピ", { timeout: 15_000 });
  await expect(page.getByTestId("recipe-detail-thumbnail").last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("recipe-detail-thumbnail-placeholder")).toHaveCount(0);
  await expect(page.getByTestId("detail-step-0-image").last()).toBeVisible();

  // --- 編集でサムネイルを削除 → 詳細でプレースホルダに戻る ---
  await page.getByTestId("recipe-detail-edit").last().click();
  await expect(page.getByTestId("editor-title").last()).toHaveValue("画像付きレシピ");
  // 編集画面では既存画像のプレビューが出ている。
  await expect(page.getByTestId("editor-thumbnail-preview").last()).toBeVisible();

  await page.getByTestId("editor-thumbnail-remove").last().click();
  await expect(page.getByTestId("editor-thumbnail-placeholder").last()).toBeVisible();
  await page.getByTestId("editor-save").last().click();

  await expect(detailTitle(page)).toHaveText("画像付きレシピ", { timeout: 15_000 });
  await expect(page.getByTestId("recipe-detail-thumbnail-placeholder").last()).toBeVisible({
    timeout: 15_000,
  });
});

/**
 * 保存エラーのポップアップ（Issue #63）。
 *
 * 保存ボタンは固定ヘッダーにあるので画面のどこからでも押せるが、エラーの
 * 表示先は各欄の直下と ScrollView の先頭しかない。下の方までスクロールして
 * 保存すると、エラーが画面外になって「押しても何も起きない」ように見えた。
 * ここでは**実際に下までスクロールした状態で保存**し、ポップアップが出て
 * 「最初のエラーへ移動」でその欄まで戻れることを確認する。
 */
test("必須未入力のまま保存するとエラーがポップアップで出る", async ({ page }) => {
  const email = `e2euser_error_${Date.now()}@example.com`;

  await page.goto("/login");
  await page.getByText("新規登録").click();
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-password").fill("TestPass123!");
  await page.getByTestId("signup-password-confirm").fill("TestPass123!");
  await page.getByTestId("signup-display-name").fill("E2E Error User");
  await page.getByTestId("signup-security-question").fill("好きな食べ物は？");
  await page.getByTestId("signup-security-answer").fill("ラーメン");
  await page.getByTestId("signup-submit").click();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("nav-create").last().click();
  await expect(page.getByTestId("editor-title")).toBeVisible();

  // タイトルを空のまま、画面の一番下まで運んでから保存する
  //（＝エラーの出る欄がビューポートの外にある状態を作る）。
  await page.getByTestId("editor-add-step").last().scrollIntoViewIfNeeded();
  await page.getByTestId("editor-save").last().click();

  // ポップアップにエラーの「場所」と「理由」が並ぶ。
  const dialog = page.getByTestId("editor-error-dialog").last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("タイトル", { exact: true })).toBeVisible();
  await expect(dialog.getByText("タイトルを入力してください")).toBeVisible();

  // 「最初のエラーへ移動」でタイトル欄まで戻る。
  await page.getByTestId("editor-error-dialog-jump").last().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("editor-title").last()).toBeInViewport({ timeout: 10_000 });
});
