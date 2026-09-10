/**
 * 遷移先の検証（destinations.ts）。
 *
 * エディタの戻り先は URL クエリ（`?from=...`）で渡すため、外部から任意の値を
 * 入れられる。許可リストの外は必ずホームに倒れること（Codex #42 レビュー指摘）。
 */
import { resolveRecipeStackDestination } from "./destinations";

describe("resolveRecipeStackDestination", () => {
  it.each(["/home", "/history", "/my-page"])("既知の destination はそのまま通す: %s", (href) => {
    expect(resolveRecipeStackDestination(href)).toBe(href);
  });

  it.each([
    undefined,
    "",
    "/notifications", // レシピ詳細のスタックを持たない
    "https://example.com/phishing", // 外部 URL（開かせない）
    "//example.com",
    "/home/../../etc",
    "/homeXXX",
  ])("既知でない値はホームに倒す: %s", (value) => {
    expect(resolveRecipeStackDestination(value)).toBe("/home");
  });
});
