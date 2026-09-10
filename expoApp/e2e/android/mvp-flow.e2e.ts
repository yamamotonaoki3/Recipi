/**
 * Android（エミュレータ）E2E: MVP 通しシナリオ（Issue #42 の受け入れ基準）。
 *
 * サインアップ → ＋ でレシピ作成（公開）→ ホーム「全体」に出る → 検索でヒット
 * → カードタップで詳細（＝閲覧記録）→ 履歴 destination に出る → ログアウト。
 *
 * testID → Android の resource-id の反映挙動・ロケータ設定の注意点は
 * signup-login-logout.e2e.ts と wdio.conf.ts の冒頭コメントを参照。
 * CI のエミュレータは既定プロファイル（320x640 dp）と小さく、UiAutomator2 は
 * ScrollView の画面外の子をツリーに出さないため、フォームの各欄は
 * `scrollToId` で可視領域へ入れてから触る。
 *
 * この小ささのおかげで、フォーム末尾が Android のナビゲーションバーに隠れて
 * 操作できない不具合（Issue #74）を捕まえられた。**エミュレータのプロファイルを
 * 大きくして回避しないこと**。狭い画面で通ることに価値がある。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testRunId = `${Date.now()}-${process.pid}`;
const testEmail = `e2euser_mvp_${testRunId}@example.com`;
const testDisplayName = "E2E MVP Android";

// 検索でこのレシピだけがヒットするよう、実行ごとに一意な材料名を使う。
const uniqueIngredient = `ズッキーニ${testRunId.slice(-6)}`;
const recipeTitle = "MVP通しレシピ";

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

describe("mvp-flow", () => {
  it("サインアップ → 作成 → ホーム → 検索 → 詳細 → 履歴 → ログアウト", async () => {
    // --- サインアップして自動ログイン ---
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

    // ホーム（5 destination のシェル）に着地する。
    await waitFor(id("home-logo"), 30_000);

    // --- ＋ から公開レシピを作成 ---
    await $(id("nav-create")).click();
    await waitFor(id("editor-thumbnail"));
    await scrollToId("editor-title").setValue(recipeTitle);
    await hideKeyboard();
    await scrollToId("g0-i0-name").setValue(uniqueIngredient);
    await hideKeyboard();
    await scrollToId("step-0-body").setValue("材料を切って炒める");
    await hideKeyboard();
    // フィード（feed=all）は公開レシピしか返さないので、公開に切り替える。
    //
    // 公開トグルはフォーム末尾にある。以前はここで「見つからない」が続いたが、
    // 原因はロケータではなく**画面が下端のセーフエリアを確保していないこと**で、
    // 末尾の約 48dp がナビゲーションバーの下から出てこなかった（Issue #74）。
    // 画面側を直したので、他の欄と同じ `scrollToId` で触れる。
    await scrollToId("editor-is-public").click();

    // 可視領域に入った後は素の id で引ける（`scrollToId` を使い回すと
    // 参照するたびにスクロールのジェスチャが走ってしまう）。
    const publicSwitch = await $(id("editor-is-public"));
    // 押せていないと、あとでフィードに出ず原因の分かりにくい失敗になる。
    // ここで ON になったことを確かめ、失敗をこの行に閉じ込める。
    await browser.waitUntil(async () => (await publicSwitch.getAttribute("checked")) === "true", {
      timeout: 10_000,
      timeoutMsg: "公開スイッチを ON にできなかった",
    });
    // 最後の入力が JS 側の reducer に反映されるまで待つ。
    await browser.pause(500);
    // `editor-save` は ScrollView の外の固定ヘッダーにあるので常に可視。
    await $(id("editor-save")).click();

    await waitFor(id("recipe-detail-title"), 30_000);
    await waitFor(`android=new UiSelector().textContains("${recipeTitle}")`, 30_000);

    // --- ホーム「全体」に新着で出る ---
    await $(id("nav-home")).click();
    await waitFor(`android=new UiSelector().textContains("${recipeTitle}")`, 30_000);

    // --- 検索（材料名でヒットする。features/search.md）---
    await $(id("home-search-input")).setValue(uniqueIngredient);
    // Android のソフトキーボードの「検索」キーで確定する（onSubmitEditing）。
    await browser.pressKeyCode(66); // KEYCODE_ENTER
    await hideKeyboard();
    await waitFor(id("home-search-chip"), 20_000);
    await waitFor(`android=new UiSelector().textContains("${recipeTitle}")`, 30_000);

    // --- カードタップで詳細（ここで POST /recipes/{id}/view が飛ぶ）---
    await $(`android=new UiSelector().textContains("${recipeTitle}")`).click();
    await waitFor(id("recipe-detail-title"), 30_000);

    // --- 履歴 destination に出る（サーバー保存の閲覧履歴）---
    await $(id("nav-history")).click();
    await waitFor(`android=new UiSelector().textContains("${recipeTitle}")`, 30_000);

    // --- 履歴の消去（確認ダイアログ → 空状態）---
    await $(id("history-clear")).click();
    await waitFor(id("history-clear-dialog-confirm"));
    await $(id("history-clear-dialog-confirm")).click();
    await waitFor(id("history-empty"), 20_000);

    // --- マイページからログアウト ---
    await $(id("nav-my-page")).click();
    await waitFor(id("my-page-logout"), 20_000);
    await $(id("my-page-logout")).click();
    await waitFor(id("login-email"), 30_000);
  });
});
