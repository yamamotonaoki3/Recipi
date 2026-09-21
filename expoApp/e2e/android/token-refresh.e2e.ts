/**
 * Android（エミュレータ）E2E: 401→リフレッシュ→リトライを実機（Hermes）で通す（Issue #246）。
 *
 * `expoApp/src/api/client.ts` の 401 リトライ経路（`request.clone()` の退避 ＋
 * `new Response()` の再構築）は、Node 上の `client.msw.test.ts` でしか
 * 検証できていなかった。Hermes ランタイム特有の `instanceof Response` の
 * 挙動差（client.ts のコメントに Issue #57 の経緯あり）を実機で確認する。
 *
 * このワークフロー（e2e-android.yml）だけ `docker-compose.e2e-android.yml`
 * で `ACCESS_TOKEN_TTL_SECONDS=60` を注入している。アクセストークンが
 * 60 秒で失効するので、65 秒待ってから保護 API を叩けば、確実に
 * 401 → リフレッシュ → リトライの経路を通る。
 *
 * 成功確認は `my-page` ではなく `history` を使う。`MyPageScreen` は
 * プロフィール取得に失敗してもセッション内の表示名にフォールバック表示
 * できてしまうため、「画面が開けた」だけでは保護 API（GET /users/me/history）
 * の成功を証明できない。`history-empty` の表示は、このリクエストが
 * 401→リフレッシュ→リトライを経て実際に成功したことの直接証拠になる
 * （閲覧履歴が空の状態でサインアップ直後に確認するため、副作用もない）。
 *
 * 対象外（この Issue の目的は検証のみ）: このテストで `client.ts` の不具合が
 * 見つかった場合、修正はこの Issue に含めず、失敗ログ・再現条件を
 * 記録した上で別 Issue に切り出す。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testRunId = `${Date.now()}-${process.pid}`;
const testEmail = `e2euser_tokenrefresh_${testRunId}@example.com`;
const testDisplayName = "E2E TokenRefresh Android";

async function waitFor(selector: string, timeout = 20_000) {
  await $(selector).waitForDisplayed({ timeout });
  return $(selector);
}

async function hideKeyboard() {
  await (browser as typeof browser & { hideKeyboard: () => Promise<void> })
    .hideKeyboard()
    .catch(() => {
      // 既に閉じている場合は無視する。
    });
}

describe("token-refresh", () => {
  it("アクセストークン失効後、401→リフレッシュ→リトライで保護APIが透過的に成功する", async function () {
    // 65秒の意図的な待機を含むため、既定の120秒（wdio.conf.ts）では
    // 窮屈になる。newCommandTimeout（240秒）に合わせて延長する。
    this.timeout(240_000);

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
    await $(id("signup-submit")).click();

    // ホーム（5 destination のシェル）に着地する。
    await waitFor(id("home-logo"), 30_000);

    // --- アクセストークンが失効するまで待つ（TTL=60秒。余裕を見て65秒）---
    await browser.pause(65_000);

    // --- 保護APIを叩く（GET /users/me/history）---
    await $(id("nav-history")).click();

    // 401→リフレッシュ→リトライが透過的に成功していれば、ログイン画面には
    // 戻らず、サインアップ直後の空の閲覧履歴が表示される。
    await waitFor(id("history-empty"), 30_000);

    // ログイン画面に戻っていないことも明示的に確認する。
    const loginEmail = await $(id("login-email"));
    if (await loginEmail.isExisting()) {
      throw new Error("401→リフレッシュ→リトライに失敗し、ログイン画面へ戻された");
    }
  });
});
