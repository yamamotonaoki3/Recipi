/**
 * Web（Chromium）E2E: アバターの表示範囲を決めてから設定する（Issue #251）。
 *
 * 写真を選ぶと切り抜きダイアログが開く。キャンセルなら何も送らず、
 * ドラッグと拡大で範囲を動かして確定すると、その範囲で `PUT /users/me/avatar` が飛び、
 * アバターが実際に読み込める。最後に削除（`DELETE`）が従来どおり動く。
 */
import path from "node:path";

import { test, expect } from "./console-guard";
import { makeRunId, signUp } from "./helpers";

const FIXTURE_IMAGE = path.join(__dirname, "..", "fixtures", "test-image.png");

test("アバター: 選ぶ → 範囲を調整 → 確定で設定、キャンセルは送らない、削除できる", async ({
  page,
}) => {
  // 送信される File の実際の画素数を控える（postData はストリーム送信だと Playwright から読めない）。
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      // openapi-fetch は Request を作ってから fetch する。複製して本文（FormData）を読む。
      const form =
        init?.body instanceof FormData
          ? init.body
          : input instanceof Request &&
              (input.headers.get("content-type") ?? "").includes("multipart")
            ? await input.clone().formData()
            : null;
      if (form) {
        for (const value of (form as unknown as { values(): Iterable<unknown> }).values()) {
          if (value instanceof File) {
            const bitmap = await createImageBitmap(value);
            (window as unknown as { __sentAvatar?: unknown }).__sentAvatar = {
              width: bitmap.width,
              height: bitmap.height,
            };
          }
        }
      }
      return original(input, init);
    };
  });
  await signUp(page, `e2euser_avatar_${makeRunId()}@example.com`, "E2E Avatar");
  const shown = (testId: string) => page.getByTestId(testId).filter({ visible: true }).first();

  await shown("nav-my-page").click();
  await shown("my-page-profile-edit").click();
  await expect(shown("profile-edit-avatar-pick")).toBeVisible({ timeout: 15_000 });
  await expect(shown("profile-edit-avatar-placeholder")).toBeVisible();

  const puts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().endsWith("/users/me/avatar")) {
      puts.push(req.url());
    }
  });

  async function pick() {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      shown("profile-edit-avatar-pick").click(),
    ]);
    await chooser.setFiles(FIXTURE_IMAGE);
    await expect(shown("avatar-crop-viewport")).toBeVisible({ timeout: 10_000 });
  }

  // --- キャンセル: ダイアログが閉じ、何も送られない ---
  await pick();
  await shown("avatar-crop-cancel").click();
  await expect(page.getByTestId("avatar-crop-viewport")).toHaveCount(0);
  await expect(shown("profile-edit-avatar-placeholder")).toBeVisible();
  expect(puts).toHaveLength(0);

  // --- 調整して確定: 拡大し、ドラッグしてから確定 ---
  await pick();
  await shown("avatar-crop-zoom-in").click();
  await shown("avatar-crop-zoom-in").click();
  const box = await shown("avatar-crop-viewport").boundingBox();
  if (!box) throw new Error("切り抜き窓の位置を取れない");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await shown("avatar-crop-confirm").click();

  await expect(shown("profile-edit-avatar-toast")).toHaveText("アバターを設定しました", {
    timeout: 15_000,
  });
  expect(puts).toHaveLength(1);
  // 送られたのは切り抜いた範囲だけ: 8x8 の元画像を 1.5 倍に拡大した窓 = 5x5 の JPEG。
  const sent = await page.evaluate(
    () => (window as unknown as { __sentAvatar?: unknown }).__sentAvatar,
  );
  expect(sent).toEqual({ width: 5, height: 5 });
  await expect(page.getByTestId("avatar-crop-viewport")).toHaveCount(0);
  // 実際に読み込めた（`toBeVisible()` は壊れた画像でも通る）。
  await expect
    .poll(
      () =>
        shown("profile-edit-avatar")
          .locator("img")
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // --- 削除は従来どおり ---
  await shown("profile-edit-avatar-remove").click();
  await expect(shown("profile-edit-avatar-toast")).toHaveText("アバターを削除しました", {
    timeout: 15_000,
  });
  await expect(shown("profile-edit-avatar-placeholder")).toBeVisible();
});
