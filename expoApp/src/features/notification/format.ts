import type { NotificationItem } from "./api";

export function notificationMessage(item: NotificationItem): string {
  const actor = item.actor.displayName;
  const title = item.recipe?.title ?? "レシピ";
  switch (item.type) {
    case "followed":
      return `${actor}さんがあなたをフォローしました`;
    case "recipe_favorited":
      return `${actor}さんが「${title}」をお気に入りに追加しました`;
    case "recipe_commented":
      return `${actor}さんが「${title}」に感想を書きました`;
    case "followee_new_recipe":
      return `${actor}さんが新しいレシピ「${title}」を投稿しました`;
  }
}

export function notificationDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
