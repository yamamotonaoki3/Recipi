/**
 * Web（Chromium）E2E: プロフィール編集とフォロー一覧（Issue #150）。
 *
 * ユーザー A（プロフィールを編集する）と B（それを見る）を、1 つのブラウザでログアウト →
 * ログインで切り替えながら次を確かめる（features/profile.md・follow.md・home-feed.md §7）。
 * - B のフォロー一覧（「フォロー中」）に A が出て、行から A のプロフィールへ移れる
 * - A のホームの「フォロワー」タブに B の公開レシピが出る。A のフォロワー一覧に B が出る
 * - A が表示名・自己紹介・URL（X は公開 ON、Instagram は公開 OFF）を保存すると、
 *   マイページ・レシピの投稿者名・感想の投稿者名・他人から見たプロフィールに反映される。
 *   自己紹介は改行を保ち、公開 OFF の Instagram は他人のプロフィールに出ない
 *
 * 感想は自分のレシピには書けない（入力欄が投稿者本人には出ない）ので、A は B のレシピに書く。
 *
 * 行の testID は `connections-row-<userId>` なので、A の ID はプロフィールの URL から、
 * B の ID はサインアップの応答から取る。感想の行は `comment-<id>` なので、本文で 1 件に
 * 絞ってから同じ行の `-author` を見る。web スタックとホームの隠れたタブで同じ要素が
 * 複数あるので、見えている要素だけを取る（`visibleText` / `filter({ visible: true })`）。
 *
 * テストデータは `e2euser_prof_{a|b}_<runId>@example.com` と `[E2E_TEST]`。
 * CI の後始末（cleanup_e2e.py）が、ユーザー・レシピ・フォロー・感想をまとめて消す。
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";

import {
  createPublicRecipe,
  logIn,
  logOut,
  makeRunId,
  searchHome,
  signUp,
  visibleText,
} from "./helpers";

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

/** レシピ詳細で感想を投稿し、一覧に出るまで待つ。 */
async function postComment(page: Page, body: string) {
  await shown(page, "comment-composer-input").fill(body);
  await shown(page, "comment-composer-submit").click();
  await expect(commentRow(page, body)).toBeVisible({ timeout: 15_000 });
}

test("フォロー一覧・フォロワータブ → プロフィール編集が各所に反映される", async ({ page }) => {
  const runId = makeRunId();
  const a = { email: `e2euser_prof_a_${runId}@example.com`, name: "E2E Prof A" };
  const b = { email: `e2euser_prof_b_${runId}@example.com`, name: "E2E Prof B" };
  const newName = "E2E Prof A2";
  const titleA = "[E2E_TEST] プロフィール確認A";
  const titleB = "[E2E_TEST] プロフィール確認B";
  const ingredientA = `プロフ材料A${runId}`;
  const ingredientB = `プロフ材料B${runId}`;
  const commentByA = "[E2E_TEST] A の感想";
  const bio = "[E2E_TEST] 自己紹介\n2 行目";

  // --- 1. A: 公開レシピを作ってログアウト ---
  // （自分のレシピには感想を書けない。感想の入力欄は投稿者本人には出ない。features/comment.md）
  await signUp(page, a.email, a.name);
  await createPublicRecipe(page, titleA, ingredientA);
  await logOut(page);

  // --- 2. B: 公開レシピを作り、A のレシピから A をフォロー ---
  const bSignup = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/auth/signup") && res.request().method() === "POST",
  );
  await signUp(page, b.email, b.name);
  const bId = ((await (await bSignup).json()) as { user: { id: string } }).user.id;
  await createPublicRecipe(page, titleB, ingredientB);
  await searchHome(page, ingredientA);
  await visibleText(page, titleA).click();
  await expect(shown(page, "recipe-detail-title")).toHaveText(titleA, { timeout: 15_000 });
  await shown(page, "recipe-detail-author").click();
  await expect(shown(page, "user-profile-display-name")).toHaveText(a.name, { timeout: 15_000 });
  const aId = /\/users\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(aId, "A のプロフィールの URL からユーザー ID を取れること").toBeTruthy();
  const follow = shown(page, "user-profile-follow");
  await expect(follow).toHaveText("フォロー");
  await follow.click();
  await expect(follow).toHaveText("フォロー中");

  // --- 3. B のフォロー一覧（フォロー中）に A が出て、行から A のプロフィールへ ---
  await shown(page, "nav-my-page").click();
  await shown(page, "my-page-following").click();
  const rowA = shown(page, `connections-row-${aId}`);
  await expect(rowA).toContainText(a.name, { timeout: 15_000 });
  await rowA.click();
  await expect(shown(page, "user-profile-display-name")).toHaveText(a.name, { timeout: 15_000 });
  await logOut(page);

  // --- 4. A: ホームの「フォロワー」タブに B のレシピ、フォロワー一覧に B ---
  await logIn(page, a.email);
  await shown(page, "home-subtab-followers").click();
  await expect(visibleText(page, titleB)).toBeVisible({ timeout: 15_000 });
  // 表示名を変える前に、B のレシピへ A が感想を書いておく（手順 6 で反映を確かめる）。
  await visibleText(page, titleB).click();
  await expect(shown(page, "recipe-detail-title")).toHaveText(titleB, { timeout: 15_000 });
  await postComment(page, commentByA);
  await shown(page, "nav-my-page").click();
  await shown(page, "my-page-followers").click();
  await expect(shown(page, `connections-row-${bId}`)).toContainText(b.name, { timeout: 15_000 });

  // --- 5. A: プロフィール編集（表示名・自己紹介・X は公開 ON・Instagram は公開 OFF）---
  await shown(page, "nav-my-page").click();
  await shown(page, "my-page-profile-edit").click();
  await expect(shown(page, "profile-edit-display-name")).toHaveValue(a.name, { timeout: 15_000 });
  await shown(page, "profile-edit-display-name").fill(newName);
  await shown(page, "profile-edit-bio").fill(bio);
  await shown(page, "profile-edit-x-url").fill("https://example.com/e2e-x");
  await shown(page, "profile-edit-x-public").click();
  // Instagram は URL を入れても公開トグルは OFF のまま（既定は全項目 OFF）。
  await shown(page, "profile-edit-instagram-url").fill("https://example.com/e2e-ig");
  await shown(page, "profile-edit-save").click();
  // 保存に成功するとマイページへ戻る。
  await expect(shown(page, "my-page-display-name")).toHaveText(newName, { timeout: 15_000 });
  await logOut(page);

  // --- 6. B から見て、投稿・感想・プロフィールに反映されている ---
  await logIn(page, b.email);
  await searchHome(page, ingredientA);
  await visibleText(page, titleA).click();
  await expect(shown(page, "recipe-detail-title")).toHaveText(titleA, { timeout: 15_000 });
  await expect(shown(page, "recipe-detail-author")).toContainText(newName, { timeout: 15_000 });
  await shown(page, "recipe-detail-author").click();
  await expect(shown(page, "user-profile-display-name")).toHaveText(newName, { timeout: 15_000 });
  // 自己紹介は改行を保って表示される。
  await expect(shown(page, "user-profile-bio")).toHaveText(bio);
  // 公開 ON の X だけが出て、公開 OFF の Instagram は出ない。
  await expect(shown(page, "user-profile-link-x")).toContainText("https://example.com/e2e-x");
  await expect(page.getByTestId("user-profile-link-instagram")).toHaveCount(0);

  // A が B のレシピに書いた感想の投稿者名も、新しい名前になっている。
  await searchHome(page, ingredientB);
  await visibleText(page, titleB).click();
  await expect(shown(page, "recipe-detail-title")).toHaveText(titleB, { timeout: 15_000 });
  const rowOfA = commentRow(page, commentByA);
  await expect(rowOfA).toBeVisible({ timeout: 15_000 });
  await expect(rowOfA.getByTestId(/-author$/)).toContainText(newName);
});
