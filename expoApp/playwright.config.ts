/**
 * Playwright（Web / Chromium）の E2E テスト設定（Issue #36）。
 *
 * Maestro Web（ベータ機能）は tapOn 直後の inputText が別の欄へ混入する
 * 再現性のある不具合があり、複数の回避策を試しても解消しなかったため、
 * Web 版の E2E は Playwright に置き換えた（実ブラウザを CDP で直接操作し、
 * React Native Web の `data-testid` をそのまま `getByTestId` で拾える）。
 * docs/lessons-learned.md の該当エントリ参照。
 *
 * CI（.github/workflows/e2e.yml）では `expo export -p web` の静的出力を
 * `npx serve` で配信し、そのオリジンを E2E_WEB_BASE_URL で渡す。
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/web",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:8081",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
