/**
 * Web E2E: 静的サーバーの設定（e2e/serve.json）が、動的ルートを対応する事前描画 HTML へ振れていること
 * （Issue #267）。
 *
 * 静的エクスポートはルートごとに HTML を作る。全ルートに `index.html` を返す `serve -s` だと、
 * URL と違う HTML がハイドレーションされて React #418 になる。`-s` を外すと動的ルートは
 * 404 になるので、`serve.json` の rewrites で `[id].html` へ振っている。その振り分けの回帰を防ぐ。
 */
import { test, expect } from "./console-guard";
import { createRecipe, makeRunId, signUp } from "./helpers";

const TABS = ["home", "history", "notifications", "my-page"];
const PATTERNS = [
  ...TABS.flatMap((tab) => [
    `/${tab}/recipes/sample-id`,
    `/${tab}/users/sample-id`,
    `/${tab}/users/sample-id/connections`,
  ]),
  "/recipes/sample-id/edit",
];

test("動的ルートの URL が、404 や別ルートの HTML ではなく事前描画 HTML を返す", async ({
  request,
}) => {
  for (const path of PATTERNS) {
    const response = await request.get(path);
    expect(response.status(), `${path} の応答`).toBe(200);
    // 事前描画された HTML（アプリのルート要素を含む）。
    expect(await response.text(), `${path} の本文`).toContain('<div id="root">');
  }
});

test("レシピ詳細を開いたまま再読み込みしても、ハイドレーション不一致が出ず表示できる", async ({
  page,
}) => {
  await signUp(page, `e2euser_static_${makeRunId()}@example.com`, "E2E Static Route");
  const id = await createRecipe(page, "[E2E_TEST] 再読み込み", "たまねぎ", { isPublic: false });
  expect(page.url()).toContain(`/recipes/${id}`);

  // 動的ルートの URL を直接読み直す（consoleGuard が #418 を検出すればここで落ちる）。
  await page.reload();
  await expect(page.getByTestId("recipe-detail-title").last()).toHaveText("[E2E_TEST] 再読み込み", {
    timeout: 15_000,
  });
});
