/**
 * Android（エミュレータ）E2E: レシピ作成 → 一覧 → 詳細 → 編集 → 保存
 * （Issue #38 受け入れ基準のフロー）。
 *
 * testID → Android の resource-id の反映挙動・ロケータ設定の注意点は
 * signup-login-logout.e2e.ts と wdio.conf.ts の冒頭コメントを参照。
 *
 * このフローは一時期「`editor-save` が見つからない」で失敗していたが、
 * 原因は SafeArea 未対応でヘッダーがステータスバーに隠れ、
 * アクセシビリティツリーから剪定されていたことだった（Issue #57 / #58）。
 * `useSafeAreaInsets()` の導入で解消済み。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testRunId = `${Date.now()}-${process.pid}`;
const testEmail = `e2euser_recipe_${testRunId}@example.com`;
const testDisplayName = "E2E Recipe Android";

type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

function scrollToId(testId: string) {
  return $(
    `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${testId}"))`,
  );
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

describe("recipe-crud", () => {
  it("レシピ作成 → 一覧 → 詳細 → 編集 → 保存", async () => {
    // サインアップして自動ログイン。
    await $('android=new UiSelector().textContains("新規登録")').click();
    await waitFor(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue(testEmail);
    await $(id("signup-password")).setValue("TestPass123!");
    await $(id("signup-password-confirm")).setValue("TestPass123!");
    await $(id("signup-display-name")).setValue(testDisplayName);
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");
    await hideKeyboard();
    await scrollToId("signup-submit").click();

    await waitFor(`android=new UiSelector().textContains("ようこそ、${testDisplayName} さん")`, 30_000);

    // レシピ作成。
    await $(id("home-link-new-recipe")).click();
    await waitFor(id("editor-title"));
    await $(id("editor-title")).setValue("Androidテストレシピ");
    await $(id("g0-i0-name")).setValue("じゃがいも");
    await $(id("g0-i0-quantity")).setValue("2");
    await $(id("g0-i0-unit")).setValue("個");
    await $(id("step-0-body")).setValue("材料を切って煮る");
    await hideKeyboard();
    // 最後の TextInput の onChangeText が JS 側の reducer に反映されるまで待つ。
    await browser.pause(500);
    await $(id("editor-save")).click();

    // 編集画面のタイトルも同じ文字列を持つため、タイトル文字列だけでは保存成功を
    // 判定できない。詳細画面固有の testID が現れることを先に確認する。
    await waitFor(id("recipe-detail-title"), 30_000);
    await waitFor('android=new UiSelector().textContains("Androidテストレシピ")', 30_000);

    // ホーム → 自分のレシピ一覧に出る。
    await $(id("recipe-detail-header-back")).click();
    await $(id("home-link-my-recipes")).click();
    await waitFor('android=new UiSelector().textContains("Androidテストレシピ")', 30_000);

    // カード → 詳細 → 編集 → 保存。
    await $('android=new UiSelector().textContains("Androidテストレシピ")').click();
    await waitFor(id("recipe-detail-edit"));
    await $(id("recipe-detail-edit")).click();
    await waitFor(id("editor-title"));
    await $(id("editor-title")).setValue("Androidテストレシピ（改）");
    await hideKeyboard();
    await $(id("editor-save")).click();

    await waitFor(id("recipe-detail-title"), 30_000);
    await waitFor('android=new UiSelector().textContains("Androidテストレシピ（改）")', 30_000);
  });
});
