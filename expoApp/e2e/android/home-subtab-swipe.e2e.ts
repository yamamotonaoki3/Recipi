/**
 * Android（エミュレータ）E2E: ホームのサブタブを横スワイプで切り替える（Issue #250）。
 *
 * 左へスワイプ → 次のタブ、右へ → 前のタブ。端で外側へスワイプしても動かない。
 * 選択状態は `accessibilityState.selected`（Android では `selected` 属性）で見る。
 */
import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testRunId = `${Date.now()}-${process.pid}`;
const testEmail = `e2euser_swipe_${testRunId}@example.com`;

type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

async function waitFor(selector: string, timeout = 20_000) {
  await $(selector).waitForDisplayed({ timeout });
  return $(selector);
}

async function hideKeyboard() {
  await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {});
}

/** 一覧の領域で横にスワイプする（direction < 0 が左へ）。距離は画面幅の 35%。縦にはほとんど動かさない。 */
async function swipe(direction: -1 | 1) {
  const { width, height } = await browser.getWindowSize();
  const y = Math.round(height * 0.55);
  const startX = Math.round(width / 2);
  const dx = Math.round(width * 0.35) * direction;
  await browser
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ x: startX, y })
    .down()
    .move({ duration: 250, x: startX + dx, y: y + 5 })
    .up()
    .perform();
}

async function isSelected(tab: string) {
  return (await $(id(`home-subtab-${tab}`)).getAttribute("selected")) === "true";
}

async function expectSelected(tab: string) {
  await browser.waitUntil(() => isSelected(tab), {
    timeout: 10_000,
    timeoutMsg: `${tab} タブが選択されなかった`,
  });
}

describe("home-subtab-swipe", () => {
  it("左右のスワイプでサブタブが切り替わり、端では動かない", async function () {
    await $('android=new UiSelector().textContains("新規登録")').click();
    await waitFor(id("signup-email"), 60_000);
    await $(id("signup-email")).setValue(testEmail);
    await $(id("signup-password")).setValue("TestPass123!");
    await $(id("signup-password-confirm")).setValue("TestPass123!");
    await $(id("signup-display-name")).setValue("E2E Swipe Android");
    await $(id("signup-security-question")).setValue("好きな食べ物は？");
    await $(id("signup-security-answer")).setValue("ラーメン");
    await hideKeyboard();
    await $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("signup-submit"))').click();
    await waitFor(id("home-logo"), 30_000);
    await expectSelected("all");

    // 端（最初のタブ）で右へスワイプしても動かない。
    await swipe(1);
    await browser.pause(500);
    if (!(await isSelected("all"))) throw new Error("先頭タブで外側へスワイプしたのに選択が動いた");

    await swipe(-1);
    await expectSelected("following");
    await swipe(-1);
    await expectSelected("followers");
    await swipe(1);
    await expectSelected("following");

    // 最後のタブまで進み、端で外側へスワイプしても動かない。
    await swipe(-1);
    await swipe(-1);
    await expectSelected("favorites");
    await swipe(-1);
    await browser.pause(500);
    if (!(await isSelected("favorites"))) throw new Error("末尾タブで外側へスワイプしたのに動いた");
  });
});
