/**
 * Android（エミュレータ）E2E: ソーシャル機能の主要な 1 本（Issue #135）。
 *
 * A: サインアップ → 公開レシピ作成 → ログアウト
 * B: サインアップ → 検索 → 詳細 → 投稿者 → フォロー → 詳細に戻って ♡ → 感想投稿
 *
 * 通知・退会は画面・API ともプラットフォーム共通なので Web（social-flow.spec.ts）で
 * 担保する。ここでは Android で差が出る入力・スクロール・キーボードを含む操作を通す。
 *
 * ロケータの注意点は signup-login-logout.e2e.ts・mvp-flow.e2e.ts・wdio.conf.ts の
 * 冒頭コメントを参照（画面外の要素は `scrollToId` で可視領域へ入れてから触る。
 * 検索の確定はボタンで行う）。
 *
 * テストデータは `e2euser_social_{a|b}_<runId>@example.com` と `[E2E_TEST]`。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const runId = `${Date.now()}-${process.pid}`;
const password = "TestPass123!";
const recipeTitle = "[E2E_TEST] 通しレシピ";
// 検索でこのレシピだけがヒットするよう、実行ごとに一意な材料名を使う。
const uniqueIngredient = `ソーシャル材料${runId.slice(-6)}`;
const comment = "[E2E_TEST] おいしかった";

type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

function scrollToId(testId: string) {
  return $(
    `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${testId}"))`,
  );
}

function byText(text: string) {
  return `android=new UiSelector().textContains("${text}")`;
}

async function waitFor(selector: string, timeout = 20_000) {
  await $(selector).waitForDisplayed({ timeout });
  return $(selector);
}

async function hideKeyboard() {
  await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {
    // 既に閉じている場合は無視する。
  });
}

async function signUp(email: string, displayName: string) {
  await waitFor(byText("新規登録"), 60_000);
  await $(byText("新規登録")).click();
  await waitFor(id("signup-email"), 60_000);
  await $(id("signup-email")).setValue(email);
  await $(id("signup-password")).setValue(password);
  await $(id("signup-password-confirm")).setValue(password);
  await $(id("signup-display-name")).setValue(displayName);
  await $(id("signup-security-question")).setValue("好きな食べ物は？");
  await $(id("signup-security-answer")).setValue("ラーメン");
  await hideKeyboard();
  await scrollToId("signup-submit").click();
  await waitFor(id("home-logo"), 30_000);
}

async function logOut() {
  await $(id("nav-my-page")).click();
  await waitFor(id("my-page-logout"), 20_000);
  await $(id("my-page-logout")).click();
  await waitFor(id("login-email"), 30_000);
}

describe("social-flow", () => {
  it("フォロー → お気に入り → 感想", async () => {
    // --- A: 公開レシピを作ってログアウト ---
    await signUp(`e2euser_social_a_${runId}@example.com`, "E2E Social A");
    await $(id("nav-create")).click();
    await waitFor(id("editor-thumbnail"));
    await scrollToId("editor-title").setValue(recipeTitle);
    await hideKeyboard();
    await scrollToId("g0-i0-name").setValue(uniqueIngredient);
    await hideKeyboard();
    await scrollToId("step-0-body").setValue("[E2E_TEST] 材料を切って炒める");
    await hideKeyboard();
    // フィード・検索は公開レシピしか返さないので、公開に切り替える。
    await scrollToId("editor-is-public").click();
    const publicSwitch = await $(id("editor-is-public"));
    await browser.waitUntil(async () => (await publicSwitch.getAttribute("checked")) === "true", {
      timeout: 10_000,
      timeoutMsg: "公開スイッチを ON にできなかった",
    });
    // 最後の入力が JS 側の reducer に反映されるまで待つ（mvp-flow.e2e.ts と同じ）。
    await browser.pause(500);
    await $(id("editor-save")).click();
    await waitFor(id("recipe-detail-title"), 30_000);
    await logOut();

    // --- B: 検索 → 詳細 → 投稿者 → フォロー ---
    await signUp(`e2euser_social_b_${runId}@example.com`, "E2E Social B");
    await $(id("home-search-input")).setValue(uniqueIngredient);
    await hideKeyboard();
    await $(id("home-search-submit")).click();
    await waitFor(id("home-search-chip"), 20_000);
    await waitFor(byText(recipeTitle), 30_000);
    await $(byText(recipeTitle)).click();
    await waitFor(id("recipe-detail-title"), 30_000);

    await scrollToId("recipe-detail-author").click();
    await waitFor(id("user-profile-follow"), 30_000);
    await $(id("user-profile-follow")).click();
    // ボタンの文言が「フォロー中」に変わるまで待つ（楽観更新の後、サーバーの応答で確定）。
    await waitFor(byText("フォロー中"), 20_000);

    // --- 詳細に戻って ♡ → 件数 1 ---
    await browser.back();
    await waitFor(id("recipe-detail-title"), 30_000);
    await scrollToId("recipe-detail-favorite").click();
    await browser.waitUntil(
      async () => (await $(id("recipe-detail-favorite-count")).getText()) === "1",
      { timeout: 20_000, timeoutMsg: "お気に入りの件数が 1 にならなかった" },
    );

    // --- 感想を投稿して一覧に出る ---
    await scrollToId("comment-composer-input").setValue(comment);
    await hideKeyboard();
    await scrollToId("comment-composer-submit").click();
    await waitFor(byText(comment), 30_000);

    await logOut();
  });
});
