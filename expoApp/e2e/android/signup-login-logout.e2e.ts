/**
 * Android（エミュレータ）E2E: 新規登録 → 自動ログイン確認 → ログアウト →
 * 再ログイン（Issue #36）。
 *
 * React Native の `testID` は Android の `resource-id`
 * （`AccessibilityNodeInfo.viewIdResourceName`）にそのまま渡されるが、
 * パッケージ名は付かない（`signup-email` のように testID の値そのまま。
 * `<package>:id/<testID>` 形式にはならない。Codex レビューで指摘・
 * 複数の React Native / Appium の issue で報告されている既知の挙動）。
 * WebdriverIO で resource-id をそのまま指定するときは `id=<値>` の形式で
 * ロケータ戦略を明示する。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;

// `hideKeyboard` は UiAutomator2 ドライバが提供する Appium 固有コマンドで、
// WebdriverIO の型定義には含まれていないため、実行時にだけ存在を仮定する。
type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

/**
 * ScrollView の外（画面下部）にあるボタン等を、Android の
 * UiScrollable でスクロールしてから探す。WebdriverIO の
 * `click()` は Web と違い、React Native の ScrollView を自動では
 * スクロールしてくれないため、この一手間が必要
 * （Codex レビューで指摘。Maestro 版はこの前段でキーボードを閉じて
 * 対処していた）。
 */
function scrollToId(testId: string) {
  // UiSelector().resourceId() にはパッケージ名を付けない生の testID を渡す
  // （上の import 直後のコメント参照）。
  return $(
    `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${testId}"))`,
  );
}

/**
 * `waitForDisplayed()` は、CI 上で「page source では displayed="true" に
 * なっているのに、待っても "still not displayed" のまま失敗し続ける」
 * という再現性のある不具合があった（60秒待っても解消しない・page source
 * では要素が正しく存在＆表示済みだったことをスクリーンショットで確認済み）。
 * `isExisting()` を使った自前のポーリングに切り替えることで回避する
 * （内部実装が異なるため、同じ不具合を踏まない可能性が高い）。
 */
async function waitUntilExists(selector: string, timeout = 30_000) {
  await browser.waitUntil(
    async () => {
      return await $(selector).isExisting();
    },
    {
      timeout,
      interval: 1_000,
      timeoutMsg: `element (${selector}) still not found after ${timeout}ms`,
    },
  );
  return $(selector);
}

describe("signup-login-logout", () => {
  it("signup → 自動ログイン確認 → logout → 再ログイン", async () => {
    // 起動後は splash → 未ログインなのでログイン画面に着地する。
    // そこから「新規登録」リンクでサインアップ画面へ移動する。
    await $('android=new UiSelector().textContains("新規登録")').click();

    // アプリの初回起動（コールドスタート）は JS バンドルの読み込み・
    // 認証復元処理（useAuthRefresh）・画面遷移が重なり、CI のエミュレータ
    // （ソフトウェアレンダリング）では時間がかかることがあるため、
    // 最初の要素だけ長めに待つ（waitUntilExists の理由は上記コメント参照）。
    await waitUntilExists(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue("e2euser_001@example.com");
    await $(id("signup-password")).setValue("TestPass123!");
    await $(id("signup-password-confirm")).setValue("TestPass123!");
    await $(id("signup-display-name")).setValue("E2EUser A");
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");

    // 「秘密の質問の答え」欄にフォーカスが残ったままだとソフトキーボードが
    // 画面下部の「登録」ボタンを覆っている可能性があるため閉じる。
    await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {
      // キーボードが既に閉じている場合は無視する。
    });
    await scrollToId("signup-submit").click();

    // 登録成功 → 自動ログイン状態でホームに遷移し、
    // 表示名入りのウェルカムメッセージが出ることを確認する。
    await waitUntilExists('android=new UiSelector().textContains("ようこそ、E2EUser A さん")');

    await $(id("home-logout")).click();

    // ログアウト後は認可ゲート（useProtectedRoute）によりログイン画面へ戻される。
    await waitUntilExists(id("login-email"));

    await $(id("login-email")).setValue("e2euser_001@example.com");
    await $(id("login-password")).setValue("TestPass123!");
    // ログイン画面は ScrollView ではなく View なので、サインアップ画面と
    // 違い UiScrollable でのスクロールは使えない（対象コンテナが無く失敗する。
    // Codex レビューで指摘）。項目数も少なく画面内に収まるため、
    // キーボードさえ閉じれば直接タップできる。
    await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {
      // キーボードが既に閉じている場合は無視する。
    });
    await $(id("login-submit")).click();

    await waitUntilExists('android=new UiSelector().textContains("ようこそ、E2EUser A さん")');
  });
});
