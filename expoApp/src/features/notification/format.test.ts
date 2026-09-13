import type { NotificationItem } from "./api";
import { notificationDate, notificationMessage } from "./format";

function item(type: NotificationItem["type"]): NotificationItem {
  return {
    id: "n1",
    type,
    readAt: null,
    createdAt: "2026-09-14T03:04:00",
    actor: { id: "u2", displayName: "花子", avatarUrl: null },
    recipe: type === "followed" ? null : { id: "r1", title: "肉じゃが" },
    comment: type === "recipe_commented" ? { id: "c1" } : null,
  };
}

describe("notificationMessage", () => {
  it.each([
    ["followed", "花子さんがあなたをフォローしました"],
    ["recipe_favorited", "花子さんが「肉じゃが」をお気に入りに追加しました"],
    ["recipe_commented", "花子さんが「肉じゃが」に感想を書きました"],
    ["followee_new_recipe", "花子さんが新しいレシピ「肉じゃが」を投稿しました"],
  ] as const)("%s の本文を作る", (type, expected) => {
    expect(notificationMessage(item(type))).toBe(expected);
  });

  it("不正な日時は空文字にする", () => {
    expect(notificationDate("invalid")).toBe("");
  });
});
