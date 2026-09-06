/**
 * Android（エミュレータ）E2E: レシピ作成 → 一覧 → 詳細 → 編集 → 保存
 * （Issue #38 受け入れ基準のフロー）。
 *
 * このジョブ（e2e-android.yml の android）は現在 continue-on-error で、
 * 画面遷移後に Appium の要素検索が効かなくなる既知の不具合を調査中
 * （Issue #50 参照）。不具合が解消したらこのフローがゲートとして機能する。
 *
 * testID → Android の resource-id の反映挙動・待機の注意点は
 * signup-login-logout.e2e.ts の冒頭コメントを参照。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;

type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

function scrollToId(testId: string) {
  return $(
    `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${testId}"))`,
  );
}

async function waitUntilExists(selector: string, timeout = 30_000) {
  await browser.waitUntil(async () => await $(selector).isExisting(), {
    timeout,
    interval: 1_000,
    timeoutMsg: `element (${selector}) still not found after ${timeout}ms`,
  });
  return $(selector);
}

async function hideKeyboard() {
  await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {
    // 既に閉じている場合は無視する。
  });
}

describe("recipe-crud", () => {
  it("レシピ作成 → 一覧 → 詳細 → 編集 → 保存", async () => {
    // サインアップして自動ログイン。
    await $('android=new UiSelector().textContains("新規登録")').click();
    await waitUntilExists(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue("e2euser_recipe_android@example.com");
    await $(id("signup-password")).setValue("TestPass123!");
    await $(id("signup-password-confirm")).setValue("TestPass123!");
    await $(id("signup-display-name")).setValue("E2E Recipe Android");
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");
    await hideKeyboard();
    await scrollToId("signup-submit").click();

    await waitUntilExists('android=new UiSelector().textContains("ようこそ、E2E Recipe Android さん")');

    // レシピ作成。
    await $(id("home-link-new-recipe")).click();
    await waitUntilExists(id("editor-title"));
    await $(id("editor-title")).setValue("Androidテストレシピ");
    await $(id("g0-i0-name")).setValue("じゃがいも");
    await $(id("step-0-body")).setValue("材料を切って煮る");
    await hideKeyboard();
    await $(id("editor-save")).click();

    await waitUntilExists('android=new UiSelector().textContains("Androidテストレシピ")');

    // ホーム → 自分のレシピ一覧に出る。
    await $(id("recipe-detail-header-back")).click();
    await $(id("home-link-my-recipes")).click();
    await waitUntilExists('android=new UiSelector().textContains("Androidテストレシピ")');

    // カード → 詳細 → 編集 → 保存。
    await $('android=new UiSelector().textContains("Androidテストレシピ")').click();
    await waitUntilExists(id("recipe-detail-edit"));
    await $(id("recipe-detail-edit")).click();
    await waitUntilExists(id("editor-title"));
    await $(id("editor-title")).setValue("Androidテストレシピ（改）");
    await hideKeyboard();
    await $(id("editor-save")).click();

    await waitUntilExists('android=new UiSelector().textContains("Androidテストレシピ（改）")');
  });
});
