/**
 * Web（Chromium）E2E: 選択中の destination の再タップ（Issue #249）。
 *
 * ホームで一覧を下へスクロールし、検索窓に文字を入れた状態で「ホーム」を押すと、
 * 一覧が最上部へ戻り、検索窓がクリアされる。一覧を確実にスクロールさせるため、
 * 画面の高さを低くして公開レシピを数件作る。
 */
import { test, expect } from "./console-guard";
import { createPublicRecipe, makeRunId, signUp } from "./helpers";

test("ホームの再タップで一覧が最上部へ戻り、検索窓もクリアされる", async ({ page }) => {
  const runId = makeRunId();
  await page.setViewportSize({ width: 420, height: 420 });
  await signUp(page, `e2euser_retap_${runId}@example.com`, "E2E Retap");

  for (let i = 1; i <= 6; i++) {
    await createPublicRecipe(page, `再タップ確認${i}`, `材料${i}`);
  }

  const shown = (testId: string) => page.getByTestId(testId).filter({ visible: true }).first();
  await shown("nav-home").click();
  const list = shown("home-feed-list");
  await expect(list).toBeVisible({ timeout: 15_000 });

  // 一覧が実際にスクロールできる状態にしてから、下へ動かす。
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
    .toBeGreaterThan(100);
  // `scrollTo` は CSS の smooth 指定で動かないことがあるので scrollTop へ直接代入する。
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);

  await shown("home-search-input").fill("下書き");

  // 選択中の「ホーム」をもう一度押す。
  await shown("nav-home").click();

  await expect(shown("home-search-input")).toHaveValue("");
  await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBe(0);

  // --- 履歴でも同じ（作ったレシピの詳細を開いた記録が 6 件ある）---
  await shown("nav-history").click();
  const history = shown("history-list");
  await expect(history).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => history.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 })
    .toBeGreaterThan(100);
  await history.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => history.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);

  await shown("nav-history").click();
  await expect.poll(() => history.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBe(0);
});
