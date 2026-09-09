/**
 * Android（エミュレータ）E2E: 画像付きレシピが一覧カードと詳細に表示される
 * （Issue #40 受け入れ基準の表示側）。
 *
 * ## なぜ「表示のみ」なのか
 *
 * 画像を選ぶ操作は端末のギャラリー（フォトピッカー）という**別アプリ**を
 * 開く。その UI は Android のバージョンごとに構造が変わるため、Appium から
 * 操作すると OS 差で壊れやすく、CI の安定性を大きく損なう。
 * 「選ぶ → 上げる → 紐付く」の経路は Web E2E（Playwright。ピッカーが
 * `<input type=file>` なので安定して自動化できる）で担保している。
 *
 * ここで確かめたいのは **RN 実機側で画像が実際に描画されるか**で、これは
 * ブラウザでは検証できない（Hermes ランタイム・ネイティブの画像表示）。
 * そこでデータは API 経由で用意し、アプリはログインして表示するだけにする。
 *
 * 注: この Node プロセスはホスト上で動くので API は `localhost`。
 * アプリ（エミュレータ内）からは `10.0.2.2` で同じサーバーに到達する。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { $, browser } from "@wdio/globals";

const id = (testId: string) => `id=${testId}`;
const testRunId = `${Date.now()}-${process.pid}`;
const testEmail = `e2euser_image_${testRunId}@example.com`;
const testPassword = "TestPass123!";
const testDisplayName = "E2E Image Android";
const recipeTitle = "画像付きAndroidレシピ";

const API = process.env.E2E_API_BASE_URL ?? "http://localhost:8000";
const FIXTURE = join(__dirname, "..", "fixtures", "test-image.png");

function scrollToId(testId: string) {
  return $(
    `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${testId}"))`,
  );
}

async function waitFor(selector: string, timeout = 20_000) {
  await $(selector).waitForDisplayed({ timeout });
  return $(selector);
}

type BrowserWithMobileCommands = typeof browser & { hideKeyboard: () => Promise<void> };

async function hideKeyboard() {
  await (browser as BrowserWithMobileCommands).hideKeyboard().catch(() => {
    // 既に閉じている場合は無視する。
  });
}

async function callApi(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} が ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/**
 * 画像付きレシピを API で用意し、そのレシピ ID を返す。
 * 一覧カードの testID は `my-recipe-<レシピ ID>` なので ID が要る。
 */
async function seedRecipeWithImages(): Promise<string> {
  const signup = await callApi("/api/v1/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      displayName: testDisplayName,
      securityQuestion: "好きな食べ物は？",
      securityAnswer: "ラーメン",
    }),
  });
  const auth = { Authorization: `Bearer ${signup.accessToken as string}` };

  // 同じ画像を 2 回上げる。1 つのキーをサムネと手順の両方に使うことは
  // できない（1 キー = 1 参照。backend が 400 で弾く）。
  const upload = async () => {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(FIXTURE)], { type: "image/png" }), "test-image.png");
    const uploaded = await callApi("/api/v1/images", { method: "POST", headers: auth, body: form });
    return uploaded.key as string;
  };
  const thumbnailKey = await upload();
  const stepImageKey = await upload();

  const created = await callApi("/api/v1/recipes", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      title: recipeTitle,
      servings: 2,
      isPublic: true,
      thumbnailKey,
      ingredientGroups: [{ name: null, ingredients: [{ name: "じゃがいも", quantity: "2" }] }],
      steps: [{ body: "材料を切って煮る", imageKey: stepImageKey }],
    }),
  });
  return created.id as string;
}

describe("recipe-image", () => {
  it("画像付きレシピが一覧カードと詳細に表示される", async () => {
    const recipeId = await seedRecipeWithImages();

    // アプリはログインするだけ（データは API で用意済み）。
    await waitFor(id("login-email"), 60_000);
    await $(id("login-email")).setValue(testEmail);
    await $(id("login-password")).setValue(testPassword);
    await hideKeyboard();
    await scrollToId("login-submit").click();

    await waitFor(`android=new UiSelector().textContains("ようこそ、${testDisplayName} さん")`, 30_000);

    // 一覧カードのサムネイル。
    await $(id("home-link-my-recipes")).click();
    await waitFor(`android=new UiSelector().textContains("${recipeTitle}")`, 30_000);
    await waitFor(id(`my-recipe-${recipeId}-thumbnail`), 30_000);

    // 詳細のサムネイルと手順画像。
    await $(`android=new UiSelector().textContains("${recipeTitle}")`).click();
    await waitFor(id("recipe-detail-title"), 30_000);
    await waitFor(id("recipe-detail-thumbnail"), 30_000);
    // 手順画像はページ下部なのでスクロールしてから確認する
    // （UiAutomator2 は ScrollView の画面外の子をツリーに出さない）。
    await scrollToId("detail-step-0-image").waitForDisplayed({ timeout: 30_000 });
  });
});
