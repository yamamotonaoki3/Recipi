/**
 * Android（エミュレータ）E2E: 新規登録 → 自動ログイン確認 → ログアウト →
 * 再ログイン（Issue #36）。
 *
 * React Native の `testID` は Android の `resource-id`
 * （`AccessibilityNodeInfo.viewIdResourceName`）にパッケージ接頭辞なしで
 * 渡される（`signup-email` のように値そのまま。`<package>:id/<testID>`
 * にはならない）。そのため wdio.conf.ts で
 * `appium:disableIdLocatorAutocompletion: true` を設定し、`id=<値>` が
 * 素の resource-id を引くようにしている（Issue #57。詳細は wdio.conf.ts
 * と docs/lessons-learned.md 参照）。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testRunId = `${Date.now()}-${process.pid}`;
const testEmail = `e2euser_${testRunId}@example.com`;
const testDisplayName = "E2EUser A";

// `hideKeyboard` は UiAutomator2 ドライバが提供する Appium 固有コマンドで、
// WebdriverIO の型定義には含まれていないため、実行時にだけ存在を仮定する。
type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

/**
 * ScrollView の外（画面下部）にあるボタン等を、Android の UiScrollable で
 * スクロールしてから探す。WebdriverIO の `click()` は Web と違い
 * React Native の ScrollView を自動ではスクロールしないため、この一手間が要る。
 */
function scrollToId(testId: string) {
  return $(
    `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${testId}"))`,
  );
}

/**
 * 指定セレクタが表示されるまで待ってから要素を返す。CI のエミュレータ
 * （ソフトウェアレンダリング）は画面遷移が遅いことがあるので、呼び出し側で
 * timeout を大きめに渡せるようにしておく。
 */
async function waitFor(selector: string, timeout = 20_000) {
  await $(selector).waitForDisplayed({ timeout });
  return $(selector);
}

async function hideKeyboard() {
  await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {
    // キーボードが既に閉じている場合は無視する。
  });
}

describe("signup-login-logout", () => {
  it("signup → 自動ログイン確認 → logout → 再ログイン", async () => {
    // 起動後は splash → 未ログインなのでログイン画面に着地する。
    // そこから「新規登録」リンクでサインアップ画面へ移動する。
    await $('android=new UiSelector().textContains("新規登録")').click();

    // 初回起動（コールドスタート）は JS バンドル読み込み・認証復元・画面遷移が
    // 重なり CI では時間がかかるため、最初の要素だけ長めに待つ。
    await waitFor(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue(testEmail);
    await $(id("signup-password")).setValue("TestPass123!");
    await $(id("signup-password-confirm")).setValue("TestPass123!");
    await $(id("signup-display-name")).setValue(testDisplayName);
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");

    // 「秘密の質問の答え」欄にフォーカスが残っているとソフトキーボードが
    // 画面下部の「登録」ボタンを覆う可能性があるため閉じる。
    await hideKeyboard();
    await scrollToId("signup-submit").click();

    // 登録成功 → 自動ログイン状態でホーム（5 destination のシェル）に着地する。
    // ホームの目印はロゴ（Issue #42 でウェルカムメッセージの仮画面は廃止）。
    await waitFor(id("home-logo"), 30_000);

    // ログアウトはマイページ destination の中（screens/my-page.md）。
    await $(id("nav-my-page")).click();
    await waitFor(id("my-page-logout"), 20_000);
    await $(id("my-page-logout")).click();

    // ログアウト後は認可ゲート（useProtectedRoute）によりログイン画面へ戻される。
    await waitFor(id("login-email"));

    await $(id("login-email")).setValue(testEmail);
    await $(id("login-password")).setValue("TestPass123!");
    // ログイン画面は ScrollView ではなく View なので UiScrollable は使えない
    // （対象コンテナが無く失敗する）。項目数も少なく画面内に収まるため、
    // キーボードを閉じれば直接タップできる。
    await hideKeyboard();
    await $(id("login-submit")).click();

    await waitFor(id("home-logo"), 30_000);
  });
});
