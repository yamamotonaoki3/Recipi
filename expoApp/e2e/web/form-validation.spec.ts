/**
 * Web E2E: ユーザー入力の不備は、APIを呼ばずに画面へ表示する（Issue #313）。
 */
import type { Page } from "@playwright/test";

import { test, expect } from "./console-guard";

async function mockUnauthenticatedRefresh(page: Page) {
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "未ログイン" } }),
    }),
  );
}

test("[Issue #313] サインアップの確認不一致は未送信で項目エラーを表示する", async ({ page }) => {
  let signupCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/signup")) signupCalls += 1;
  });

  await mockUnauthenticatedRefresh(page);
  await page.goto("/signup");
  await page.getByTestId("signup-email").fill("e2e-validation@example.com");
  await page.getByTestId("signup-password").fill("TestPass123!");
  await page.getByTestId("signup-password-confirm").fill("Different1!");
  await page.getByTestId("signup-submit").click();

  await expect(page.getByText("パスワードが一致しません")).toBeVisible();
  expect(signupCalls).toBe(0);
});

test("[Issue #313] ログインの空欄は未送信で項目エラーを表示する", async ({ page }) => {
  let loginCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/login")) loginCalls += 1;
  });

  await mockUnauthenticatedRefresh(page);
  await page.goto("/login");
  await page.getByTestId("login-submit").click();

  await expect(page.getByText("メールアドレスを入力してください")).toBeVisible();
  await expect(page.getByText("パスワードを入力してください")).toBeVisible();
  expect(loginCalls).toBe(0);
});

test("[Issue #313] パスワード再設定のメール形式不正は未送信で表示する", async ({ page }) => {
  let requestCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/password-reset/request")) requestCalls += 1;
  });

  await mockUnauthenticatedRefresh(page);
  await page.goto("/password-reset");
  await page.getByTestId("password-reset-email").fill("invalid-email");
  await page.getByTestId("password-reset-request-submit").click();

  await expect(page.getByText("有効なメールアドレスを入力してください")).toBeVisible();
  expect(requestCalls).toBe(0);
});
