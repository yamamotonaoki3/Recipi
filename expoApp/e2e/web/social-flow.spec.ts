/**
 * Web（Chromium）E2E: ソーシャル機能の通しシナリオ（Issue #135）。
 *
 * 2 ユーザー（A = 投稿者、B = 閲覧者）を 1 つのブラウザでログアウト → ログインで
 * 切り替えながら、フォロー → フォロー・タブ → お気に入り → 感想 → 相手側の通知・
 * 未読バッジ → 既読化 → 退会 を通す。
 *
 * - 通知の文言は `features/notification/format.ts` の `notificationMessage` と同じ文
 * - 未読の行は読み上げラベルの頭に「未読、」が付く（`NotificationItem.tsx`）ので、
 *   それで未読 / 既読を見分ける
 * - 退会したアカウントでログインすると、エラーではなく再開の確認ダイアログが出る
 *   （`app/(auth)/login.tsx`）。一度キャンセルしてログイン画面に留まることを見てから、
 *   A の退会中に「B のお気に入りに A のレシピが残っている」ことを確かめ、最後に A を
 *   再開して「投稿レシピが消えていない」ことを確かめる
 *
 * テストデータは `e2euser_social_{a|b}_<runId>@example.com`、レシピ・感想は
 * `[E2E_TEST]` 付き。CI では e2e.yml の後始末ステップ（cleanup_e2e.py）が消す。
 */
import { expect, test } from "@playwright/test";

import {
  createPublicRecipe,
  logIn,
  logOut,
  makeRunId,
  searchHome,
  signUp,
  visibleText,
} from "./helpers";

test("フォロー → お気に入り → 感想 → 通知 → 既読 → 退会 → 再開", async ({ page }) => {
  const runId = makeRunId();
  const a = { email: `e2euser_social_a_${runId}@example.com`, name: "E2E Social A" };
  const b = { email: `e2euser_social_b_${runId}@example.com`, name: "E2E Social B" };
  const title = "[E2E_TEST] 通しレシピ";
  // 検索でこのレシピだけがヒットするよう、実行ごとに一意な材料名にする。
  const ingredient = `ソーシャル材料${runId}`;
  const comment = "[E2E_TEST] おいしかった";

  // --- A: 公開レシピを作ってログアウト ---
  await signUp(page, a.email, a.name);
  await createPublicRecipe(page, title, ingredient);
  await logOut(page);

  // --- B: 検索で A のレシピを開き、投稿者のプロフィールからフォロー ---
  await signUp(page, b.email, b.name);
  await searchHome(page, ingredient);
  await visibleText(page, title).click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(title, {
    timeout: 15_000,
  });
  await page.getByTestId("recipe-detail-author").last().click();
  const follow = page.getByTestId("user-profile-follow").last();
  await expect(follow).toHaveText("フォロー", { timeout: 15_000 });
  await follow.click();
  await expect(follow).toHaveText("フォロー中");

  // --- ホームの「フォロー」タブに A のレシピが出る ---
  await page.getByTestId("nav-home").last().click();
  await page.getByTestId("home-subtab-following").last().click();
  await visibleText(page, title).click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(title, {
    timeout: 15_000,
  });

  // --- お気に入り（件数が 1 になる）→ 感想を投稿して一覧に出る ---
  await page.getByTestId("recipe-detail-favorite").last().click();
  await expect(page.getByTestId("recipe-detail-favorite-count").last()).toHaveText("1");
  await page.getByTestId("comment-composer-input").last().fill(comment);
  await page.getByTestId("comment-composer-submit").last().click();
  await expect(visibleText(page, comment)).toBeVisible({ timeout: 15_000 });
  await logOut(page);

  // --- A: 3 種類の通知が未読で届いている ---
  await logIn(page, a.email);
  const followed = `${b.name}さんがあなたをフォローしました`;
  const favorited = `${b.name}さんが「${title}」をお気に入りに追加しました`;
  const commented = `${b.name}さんが「${title}」に感想を書きました`;
  const unreadRow = (message: string) =>
    page.getByRole("button", { name: `未読、${message}`, exact: true });
  const anyRow = (message: string) =>
    page.getByRole("button", { name: new RegExp(`^(未読、)?${escapeRegExp(message)}$`) });

  await page.getByTestId("nav-notifications").last().click();
  // 一覧の取得タイミングに左右されないよう、「更新」で取り直しながら 3 件そろうのを待つ。
  await expect
    .poll(
      async () => {
        await page.getByTestId("notifications-refresh").last().click();
        return (
          (await unreadRow(followed).count()) +
          (await unreadRow(favorited).count()) +
          (await unreadRow(commented).count())
        );
      },
      { timeout: 30_000 },
    )
    .toBe(3);
  await expect(page.getByTestId("nav-notifications-badge").last()).toHaveText("3", {
    timeout: 15_000,
  });

  // --- 感想の通知をタップ → レシピ詳細 → 戻るとその行だけ既読・バッジ 2 ---
  await unreadRow(commented).last().click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(title, {
    timeout: 15_000,
  });
  await page.getByTestId("nav-notifications").last().click();
  await page.getByTestId("notifications-refresh").last().click();
  await expect(unreadRow(commented)).toHaveCount(0, { timeout: 15_000 });
  await expect(anyRow(commented).last()).toBeVisible();
  await expect(page.getByTestId("nav-notifications-badge").last()).toHaveText("2", {
    timeout: 15_000,
  });

  // --- すべて既読 → 未読の行もバッジも無くなる ---
  await page.getByTestId("notifications-read-all").last().click();
  await expect(page.getByRole("button", { name: /^未読、/ })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("nav-notifications-badge")).toHaveCount(0, { timeout: 15_000 });

  // --- 退会 → ログイン画面。同じアカウントでは入れず、再開の確認が出る ---
  await page.getByTestId("nav-my-page").last().click();
  await page.getByTestId("my-page-delete-account").last().click();
  const deleted = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/users/me") && res.request().method() === "DELETE",
  );
  await page.getByTestId("my-page-delete-account-confirm-confirm").last().click();
  expect((await deleted).ok()).toBe(true);
  await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("login-email").fill(a.email);
  await page.getByTestId("login-password").fill("TestPass123!");
  const refused = page.waitForResponse(
    (res) => res.url().endsWith("/api/v1/auth/login") && res.request().method() === "POST",
  );
  await page.getByTestId("login-submit").click();
  const loginResponse = await refused;
  expect(loginResponse.status()).toBeGreaterThanOrEqual(400);
  expect(loginResponse.status()).toBeLessThan(500);
  await expect(page.getByTestId("account-reactivate-dialog")).toBeVisible();
  await page.getByTestId("account-reactivate-dialog-cancel").click();
  await expect(page.getByTestId("account-reactivate-dialog")).toHaveCount(0);
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.getByTestId("home-logo")).toHaveCount(0);

  // --- A の退会中: B のお気に入りに A のレシピが残っている ---
  // 退会で消えるのは本人のフォロー・お気に入り・感想・通知・閲覧履歴だけで、
  // 投稿レシピと「他人が付けたお気に入り」は残る（services/account.py）。
  // 退会中の投稿者は「アカウント削除済み」と表示される（data-model.md「アカウント退会」）。
  await logIn(page, b.email);
  await page.getByTestId("home-subtab-favorites").last().click();
  await visibleText(page, title).click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(title, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("recipe-detail-favorite-count").last()).toHaveText("1");
  await expect(page.getByTestId("recipe-detail-author").last()).toContainText("アカウント削除済み");
  await logOut(page);

  // --- 再開: 投稿レシピは消えておらず、再開すれば元どおり使える ---
  await page.getByTestId("login-email").fill(a.email);
  await page.getByTestId("login-password").fill("TestPass123!");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-reactivate-dialog")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("account-reactivate-dialog-confirm").click();
  await expect(page.getByTestId("home-logo").last()).toBeVisible({ timeout: 15_000 });

  // A の投稿レシピは消えていない（検索で見つかり、詳細を開ける）。
  await searchHome(page, ingredient);
  await visibleText(page, title).click();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText(title, {
    timeout: 15_000,
  });
  // 再開後は投稿者名が元に戻る。
  await expect(page.getByTestId("recipe-detail-author").last()).toContainText(a.name);
});

/** 正規表現で使えるように、文字列中の記号をエスケープする。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
