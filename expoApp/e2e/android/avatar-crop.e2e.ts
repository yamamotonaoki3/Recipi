/**
 * Android（エミュレータ）E2E: アバターの表示範囲を決めてから設定する（Issue #251）。
 *
 * システムの写真ピッカーで写真を選ぶ → 切り抜きダイアログ → ドラッグと拡大 → 確定 → 設定される。
 * キャンセルは何も設定しない。
 *
 * 事前に、非公開画像の題材として使える写真を端末のギャラリーへ入れておく必要がある
 * （CI・ローカルとも `adb push` ＋ メディアスキャン。手順は `docs/requirements/testing.md`）。
 * ピッカーはシステムのアプリ（`com.google.android.providers.media.module`）で、
 * サムネイルは `icon_thumbnail`。「最近」の先頭（＝最新の1枚）を選ぶ。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testEmail = `e2euser_avatarcrop_${Date.now()}-${process.pid}@example.com`;
const THUMBNAIL =
  'android=new UiSelector().resourceId("com.google.android.providers.media.module:id/icon_thumbnail")';

async function waitFor(selector: string, timeout = 20_000) {
  await $(selector).waitForDisplayed({ timeout });
  return $(selector);
}

async function openPickerAndChoosePhoto() {
  await $(id("profile-edit-avatar-pick")).click();
  await waitFor(THUMBNAIL, 20_000);
  await $(THUMBNAIL).click();
  await waitFor(id("avatar-crop-viewport"), 20_000);
}

/** 切り抜きの窓の中でドラッグする（dxRatio・dyRatio は窓の大きさに対する割合）。 */
async function dragViewport(dxRatio: number, dyRatio: number) {
  const viewport = $(id("avatar-crop-viewport"));
  const rect = await viewport.getElementRect((await viewport.elementId) as string);
  const cx = Math.round(rect.x + rect.width / 2);
  const cy = Math.round(rect.y + rect.height / 2);
  await browser
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ x: cx, y: cy })
    .down()
    .move({
      duration: 300,
      x: cx + Math.round(rect.width * dxRatio),
      y: cy + Math.round(rect.height * dyRatio),
    })
    .up()
    .perform();
}

describe("avatar-crop", () => {
  it("写真を選ぶ → 範囲を調整 → 確定で設定、キャンセルでは設定しない", async function () {
    this.timeout(240_000);

    await $('android=new UiSelector().textContains("新規登録")').click();
    await waitFor(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue(testEmail);
    await $(id("signup-password")).setValue("TestPass123!");
    await $(id("signup-password-confirm")).setValue("TestPass123!");
    await $(id("signup-display-name")).setValue("E2E Avatar Android");
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");
    await browser.hideKeyboard().catch(() => {});
    await $(
      'android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("signup-submit"))',
    ).click();
    await waitFor(id("home-logo"), 30_000);

    await $(id("nav-my-page")).click();
    await waitFor(id("my-page-profile-edit"));
    await $(id("my-page-profile-edit")).click();
    await waitFor(id("profile-edit-avatar-pick"));
    await waitFor(id("profile-edit-avatar-placeholder"));

    // --- キャンセル: ダイアログが閉じ、アバターは未設定のまま ---
    await openPickerAndChoosePhoto();
    await $(id("avatar-crop-cancel")).click();
    await $(id("avatar-crop-viewport")).waitForDisplayed({ reverse: true, timeout: 10_000 });
    await waitFor(id("profile-edit-avatar-placeholder"));

    // --- 調整して確定: 拡大 → ドラッグ → 確定 ---
    await openPickerAndChoosePhoto();
    await $(id("avatar-crop-zoom-in")).click();
    await $(id("avatar-crop-zoom-in")).click();
    await $(id("avatar-crop-zoom-in")).click();
    await dragViewport(0, -0.3);
    await $(id("avatar-crop-confirm")).click();

    // トースト（「アバターを設定しました」）は 2 秒で自然に消えるため、確認は
    // 「画像アバターに切り替わり、頭文字のプレースホルダではなくなった」ことで行う。
    await browser.waitUntil(
      async () =>
        (await $(id("avatar-crop-viewport")).isExisting()) === false &&
        (await $(id("profile-edit-avatar-placeholder")).isExisting()) === false &&
        (await $(id("profile-edit-avatar")).isExisting()) === true,
      { timeout: 30_000, timeoutMsg: "確定後もアバターが画像に切り替わらなかった" },
    );
  });
});
