const deletedRecipeIds = new Set<string>();
const STORAGE_KEY = "recipi.deleted-recipe-ids";

function readStoredIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredIds(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...deletedRecipeIds]));
  } catch {
    // Storage is optional (SSR/private browsing); memory state remains authoritative.
  }
}

for (const recipeId of readStoredIds()) deletedRecipeIds.add(recipeId);

export function markRecipeDeleted(recipeId: string): void {
  deletedRecipeIds.add(recipeId);
  writeStoredIds();
}

export function unmarkRecipeDeleted(recipeId: string): void {
  deletedRecipeIds.delete(recipeId);
  writeStoredIds();
}

export function isRecipeDeleted(recipeId: string | undefined): boolean {
  return recipeId !== undefined && deletedRecipeIds.has(recipeId);
}
