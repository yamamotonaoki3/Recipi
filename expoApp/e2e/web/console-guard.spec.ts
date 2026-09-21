/**
 * コンソール監視（console-guard.ts）自体の検証（Issue #247）。
 *
 * **通るだけの検査を入れない**ため、ゲートが本当に落ちることを確かめる。アプリも DB も
 * 使わず、`page.setContent()` で作った最小のページだけで動く。
 *
 * 判定ロジックは `ConsoleGuard` を直接使って確かめる（失敗の理由がゲートの診断である
 * ことまで見るため）。フィクスチャの後始末でテストが実際に落ちることは、`test.fail()`
 * で別に確かめる。
 */
import { ConsoleGuard, expect, test } from "./console-guard";

async function guardedPage(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const guard = new ConsoleGuard();
  guard.watch(page);
  return { context, page, guard };
}

test("console.error を検出する", async ({ browser }) => {
  const { context, page, guard } = await guardedPage(browser);
  try {
    await page.setContent(`<script>console.error("probe-console-error")</script>`);
    await expect.poll(() => guard.unexpected().length).toBe(1);
    expect(guard.unexpected()[0]).toMatchObject({ kind: "console", text: "probe-console-error" });
    expect(() => guard.assertClean()).toThrow(/コンソール監視（Issue #247）.*probe-console-error/s);
  } finally {
    await context.close();
  }
});

test("イベントハンドラの未捕捉例外を検出する", async ({ browser }) => {
  const { context, page, guard } = await guardedPage(browser);
  try {
    await page.setContent(
      `<button id="b" onclick="throw new Error('probe-handler-error')">x</button>`,
    );
    // evaluate で投げると evaluate 自体の失敗になってしまうので、実際にクリックする。
    await page.click("#b");
    await expect.poll(() => guard.unexpected().length).toBe(1);
    expect(guard.unexpected()[0]).toMatchObject({
      kind: "pageerror",
      text: "probe-handler-error",
    });
  } finally {
    await context.close();
  }
});

test("console.warn と console.log は対象外", async ({ browser }) => {
  const { context, page, guard } = await guardedPage(browser);
  try {
    await page.setContent(`<script>console.warn("w"); console.log("l")</script>`);
    // 何も起きないことを確かめるので、イベントが届く猶予を少し置く。
    await page.waitForTimeout(200);
    expect(guard.unexpected()).toEqual([]);
  } finally {
    await context.close();
  }
});

test("許可は種類・メッセージ・URL がすべて合うものだけに効く", async ({ browser }) => {
  const { context, page, guard } = await guardedPage(browser);
  try {
    guard.allow({ kind: "console", message: /^probe-allowed$/, reason: "検証用" });
    await page.setContent(
      `<script>console.error("probe-allowed"); console.error("probe-not-allowed")</script>`,
    );
    await expect.poll(() => guard.unexpected().length).toBe(1);
    expect(guard.unexpected()[0].text).toBe("probe-not-allowed");
  } finally {
    await context.close();
  }
});

test("理由の無い許可・空のパターンは受け付けない", () => {
  const guard = new ConsoleGuard();
  expect(() => guard.allow({ kind: "console", message: /x/, reason: " " })).toThrow();
  expect(() => guard.allow({ kind: "console", message: new RegExp(""), reason: "r" })).toThrow();
});

// ここから下はフィクスチャの配線の確認。ゲートがテストを落とすことを期待しているので
// test.fail() を付ける（落ちなければ「期待した失敗が起きなかった」として失敗扱いになる）。
test("組み込みの page で出た console.error はテストを落とす", async ({ page }) => {
  test.fail();
  await page.setContent(`<script>console.error("probe-fixture")</script>`);
  await page.waitForTimeout(200);
});

test("自分で作ったページも watch すれば監視される", async ({ browser, consoleGuard }) => {
  test.fail();
  const context = await browser.newContext();
  const page = await context.newPage();
  consoleGuard.watch(page);
  await page.setContent(`<script>console.error("probe-device-b")</script>`);
  await page.waitForTimeout(200);
  await context.close();
});
