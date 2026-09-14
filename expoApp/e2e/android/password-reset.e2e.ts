/**
 * Android（エミュレータ）E2E: パスワード再設定（Issue #149）。
 *
 * 登録 → ログアウト → 「パスワードをお忘れの方」→ 質問表示 → 答え＋新パスワード →
 * ログイン画面 → 新しいパスワードでログイン、の 1 本。
 *
 * 誤入力の表示や、再設定前にログインしていた端末の無効化は Web（password-reset.spec.ts）で
 * 担保する。ここでは Android で差が出る入力・キーボード・スクロールに絞る。再設定画面は
 * ScrollView なので、小さい既定エミュレータでも欄ごとにキーボードを閉じてから `scrollToId`
 * で可視化する（mvp-flow.e2e.ts と同じ書き方）。
 *
 * テストデータは `e2euser_reset_<runId>@example.com`。CI の後始末（cleanup_e2e.py）が消す。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const runId = `${Date.now()}-${process.pid}`;
const email = `e2euser_reset_${runId}@example.com`;
const password = "TestPass123!";
const newPassword = "NewTestPass456!";

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

describe("password-reset", () => {
  it("登録 → ログアウト → 再設定 → 新しいパスワードでログイン", async () => {
    // --- 登録して自動ログイン ---
    await waitFor(byText("新規登録"), 60_000);
    await $(byText("新規登録")).click();
    await waitFor(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue(email);
    await $(id("signup-password")).setValue(password);
    await $(id("signup-password-confirm")).setValue(password);
    await $(id("signup-display-name")).setValue("E2E Reset Android");
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");
    await hideKeyboard();
    await scrollToId("signup-submit").click();
    await waitFor(id("home-logo"), 30_000);

    // --- ログアウト ---
    await $(id("nav-my-page")).click();
    await waitFor(id("my-page-logout"), 20_000);
    await $(id("my-page-logout")).click();
    await waitFor(id("login-email"), 30_000);

    // --- 再設定: 質問を表示 ---
    await $(byText("パスワードをお忘れの方")).click();
    await waitFor(id("password-reset-email"), 30_000);
    await $(id("password-reset-email")).setValue(email);
    await hideKeyboard();
    await scrollToId("password-reset-request-submit").click();
    await waitFor(byText("好きな食べ物は？"), 30_000);

    // --- 答え＋新パスワード（欄ごとにキーボードを閉じてから可視化する） ---
    await scrollToId("password-reset-security-answer").setValue("ラーメン");
    await hideKeyboard();
    await scrollToId("password-reset-new-password").setValue(newPassword);
    await hideKeyboard();
    await scrollToId("password-reset-new-password-confirm").setValue(newPassword);
    await hideKeyboard();
    await scrollToId("password-reset-confirm-submit").click();

    // --- ログイン画面に戻り、新しいパスワードでログインできる ---
    await waitFor(id("login-email"), 30_000);
    await $(id("login-email")).setValue(email);
    await $(id("login-password")).setValue(newPassword);
    await hideKeyboard();
    await $(id("login-submit")).click();
    await waitFor(id("home-logo"), 30_000);
  });
});
