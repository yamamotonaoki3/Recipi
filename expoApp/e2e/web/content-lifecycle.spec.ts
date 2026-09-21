/**
 * Web（Chromium）E2E: レシピ削除・非公開・解除・感想の編集削除・新着通知（Issue #151）。
 *
 * ユーザー A（レシピを作る・消す）と B（見る・操作する）を、1 つのブラウザでログアウト →
 * ログインで切り替えながら次を確かめる（features/recipe.md・favorite.md・follow.md・
 * comment.md・notification.md・view-history.md §7）。
 * - 非公開レシピは自分のマイレシピに「非公開」バッジが付き、他人の検索には出ない
 * - お気に入り・フォローは押すたびに登録 / 解除が切り替わる（件数・文言が戻る）
 * - 自分の感想は行の中で編集でき、確認ダイアログを経て削除できる
 * - フォロー中の人が公開レシピを投稿すると、新着の通知が届く
 * - レシピを削除すると、通知・お気に入り・閲覧履歴・検索から消える
 *
 * 気をつけていること:
 * - 感想は投稿者本人のレシピには書けない（入力欄が出ない）ので、B が A のレシピに書く
 * - お気に入り・フォローのボタンは通信中は押せない。文言 / 件数が変わった後、押せる状態に
 *   戻るのを待ってから次を押す
 * - 「出ない」ことは、同じ画面で出るべきものが見えてから、対象の見えている要素が 0 件で確かめる
 * - ログアウトで TanStack Query のキャッシュは消えるので、A の削除の後に B が入り直した画面は
 *   新しく取得した内容になる
 * - web スタックとホームの隠れたタブで同じ要素が複数あるので、見えている要素だけを取る
 *
 * テストデータは `e2euser_life_{a|b}_<runId>@example.com` と `[E2E_TEST]`。
 * CI の後始末（cleanup_e2e.py）が、ユーザー・レシピ・フォロー・お気に入り・感想・通知を消す。
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";

import { createRecipe, logIn, logOut, makeRunId, searchHome, signUp, visibleText } from "./helpers";

/** 見えている要素だけを testID で取る（同じ testID が DOM に複数ありうるため）。 */
function shown(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

/** 本文が `body` の感想の行（`comment-<uuid>`）。 */
function commentRow(page: Page, body: string) {
  return page
    .getByTestId(/^comment-[0-9a-f-]{36}$/)
    .filter({ hasText: body })
    .filter({ visible: true })
    .first();
}

/** 通知画面を開き、「更新」で取り直しながら `message` の行が見えるまで待つ。 */
async function waitForNotification(page: Page, message: string) {
  await shown(page, "nav-notifications").click();
  await expect
    .poll(
      async () => {
        const refresh = shown(page, "notifications-refresh");
        await expect(refresh).toBeEnabled({ timeout: 15_000 });
        await refresh.click();
        return page.getByText(message, { exact: true }).filter({ visible: true }).count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

test("非公開・解除・感想の編集削除・新着通知・レシピ削除", async ({ page, consoleGuard }) => {
  // 一時許可（本物の不具合）: レシピ削除後に、削除済みレシピの感想一覧を取りに行って 404 になる。
  // **#269 を直したらこの許可を消すこと。**
  consoleGuard.allow({
    kind: "console",
    message: /status of 404 \(Not Found\)/,
    url: /\/api\/v1\/recipes\/[0-9a-f-]+\/comments/,
    reason: "#269: レシピ削除後の感想一覧の再取得（削除時にクエリを破棄していない）",
  });
  const runId = makeRunId();
  const a = { email: `e2euser_life_a_${runId}@example.com`, name: "E2E Life A" };
  const b = { email: `e2euser_life_b_${runId}@example.com`, name: "E2E Life B" };
  const prefix = `ライフ材料${runId}`;
  const r1 = { title: "[E2E_TEST] ライフ公開", ingredient: `${prefix}公開` };
  const r2 = { title: "[E2E_TEST] ライフ非公開", ingredient: `${prefix}非公開` };
  const r3 = { title: "[E2E_TEST] ライフ新着", ingredient: `${prefix}新着` };
  const before = "[E2E_TEST] 編集前";
  const after = "[E2E_TEST] 編集後";

  // --- 1. A: 公開 R1・非公開 R2 を作り、マイレシピで R2 にだけ「非公開」バッジ ---
  await signUp(page, a.email, a.name);
  const r1Id = await createRecipe(page, r1.title, r1.ingredient, { isPublic: true });
  const r2Id = await createRecipe(page, r2.title, r2.ingredient, { isPublic: false });
  await shown(page, "nav-my-page").click();
  await shown(page, "my-page-my-recipes").click();
  await expect(shown(page, `my-recipe-${r2Id}-private-badge`)).toHaveText("非公開", {
    timeout: 15_000,
  });
  await expect(shown(page, `my-recipe-${r1Id}`)).toBeVisible();
  await expect(page.getByTestId(`my-recipe-${r1Id}-private-badge`)).toHaveCount(0);
  await logOut(page);

  // --- 2. B: 検索で R1 は出て R2 は出ない → R1 の詳細 ---
  await signUp(page, b.email, b.name);
  await searchHome(page, prefix);
  await expect(visibleText(page, r1.title)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(r2.title, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await visibleText(page, r1.title).click();
  await expect(shown(page, "recipe-detail-title")).toHaveText(r1.title, { timeout: 15_000 });

  // お気に入り: 登録 → 解除 → 登録（押すたびに件数が変わり、押せる状態に戻るのを待つ）
  const favorite = shown(page, "recipe-detail-favorite");
  const favoriteCount = shown(page, "recipe-detail-favorite-count");
  for (const expected of ["1", "0", "1"]) {
    await expect(favorite).toBeEnabled();
    await favorite.click();
    await expect(favoriteCount).toHaveText(expected);
  }
  await expect(favorite).toBeEnabled();

  // 感想: 投稿 → 行の中で編集 → 確認ダイアログを経て削除
  await shown(page, "comment-composer-input").fill(before);
  await shown(page, "comment-composer-submit").click();
  // 編集を始めると本文が入力欄に入れ替わり、本文の文字で行を探せなくなる（hasText は入力欄の
  // 値を見ない）。最初に見つけた行の testID（`comment-<id>`）を覚え、以降はそれで同じ行を追う。
  const found = commentRow(page, before);
  await expect(found).toBeVisible({ timeout: 15_000 });
  const rowTestId = await found.getAttribute("data-testid");
  expect(rowTestId, "感想の行の testID を取れること").toBeTruthy();
  const row = shown(page, rowTestId as string);
  await row.getByTestId(/-edit$/).click();
  const editor = row.getByTestId(/-editor-input$/);
  await expect(editor).toBeVisible();
  await editor.fill(after);
  await row.getByTestId(/-editor-submit$/).click();
  const edited = commentRow(page, after);
  await expect(edited).toBeVisible({ timeout: 15_000 });
  await expect(commentRow(page, before)).toHaveCount(0);
  await edited.getByTestId(/-delete$/).click();
  await shown(page, "comment-delete-dialog-confirm").click();
  await expect(commentRow(page, after)).toHaveCount(0, { timeout: 15_000 });

  // フォロー: フォロー → 解除 → フォロー（最後はフォローしたまま。手順 4 の新着通知のため）
  await shown(page, "recipe-detail-author").click();
  const follow = shown(page, "user-profile-follow");
  for (const expected of ["フォロー中", "フォロー", "フォロー中"]) {
    await expect(follow).toBeEnabled({ timeout: 15_000 });
    await follow.click();
    await expect(follow).toHaveText(expected);
  }
  await expect(follow).toBeEnabled();
  await logOut(page);

  // --- 3. A: 公開 R3 を投稿（B に新着通知）→ R1 のお気に入り通知 → R1 を削除 → 通知が消える ---
  await logIn(page, a.email);
  await createRecipe(page, r3.title, r3.ingredient, { isPublic: true });
  const favoritedR1 = `${b.name}さんが「${r1.title}」をお気に入りに追加しました`;
  await waitForNotification(page, favoritedR1);

  await searchHome(page, r1.ingredient);
  await visibleText(page, r1.title).click();
  await expect(shown(page, "recipe-detail-title")).toHaveText(r1.title, { timeout: 15_000 });
  const deleted = page.waitForResponse(
    (res) => res.url().endsWith(`/api/v1/recipes/${r1Id}`) && res.request().method() === "DELETE",
  );
  await shown(page, "recipe-detail-delete").click();
  await shown(page, "recipe-delete-dialog-confirm").click();
  expect((await deleted).ok()).toBe(true);

  await shown(page, "nav-notifications").click();
  await shown(page, "notifications-refresh").click();
  await expect(page.getByText(favoritedR1, { exact: true }).filter({ visible: true })).toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await logOut(page);

  // --- 4. B: 新着通知が届き、削除した R1 はお気に入り・履歴・検索から消えている ---
  await logIn(page, b.email);
  await waitForNotification(page, `${a.name}さんが新しいレシピ「${r3.title}」を投稿しました`);

  await shown(page, "nav-home").click();
  await shown(page, "home-subtab-favorites").click();
  await expect(shown(page, "home-subtab-favorites")).toBeVisible();
  await expect(page.getByText(r1.title, { exact: true }).filter({ visible: true })).toHaveCount(0, {
    timeout: 15_000,
  });

  await shown(page, "nav-history").click();
  await expect(shown(page, "history-clear")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(r1.title, { exact: true }).filter({ visible: true })).toHaveCount(0, {
    timeout: 15_000,
  });

  // 検索は、出るべき R3 が見えてから、R1（削除済み）と R2（非公開）が 0 件であることを見る。
  // 検索は表示中のサブタブの中で絞り込む（home-feed.md）ので、先に「全体」へ戻す
  // （直前にお気に入りタブを開いているため、そのままだと R3 も出ない）。
  await shown(page, "nav-home").click();
  await shown(page, "home-subtab-all").click();
  await searchHome(page, prefix);
  await expect(visibleText(page, r3.title)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(r1.title, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText(r2.title, { exact: true }).filter({ visible: true })).toHaveCount(0);
});
