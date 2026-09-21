const deletedRecipeIds = new Set<string>();

export function markRecipeDeleted(recipeId: string): void {
  deletedRecipeIds.add(recipeId);
}

export function unmarkRecipeDeleted(recipeId: string): void {
  deletedRecipeIds.delete(recipeId);
}

export function isRecipeDeleted(recipeId: string | undefined): boolean {
  return recipeId !== undefined && deletedRecipeIds.has(recipeId);
}
