import { act, renderHook, waitFor } from "@testing-library/react-native";

import type { RecipeResponse } from "./api";
import { useRecipeForm } from "./useRecipeForm";

function recipe(title: string): RecipeResponse {
  return {
    id: "recipe-1",
    author: { id: "user-1", displayName: "太郎" },
    title,
    description: "説明",
    servings: 2,
    isPublic: false,
    thumbnailUrl: null,
    thumbnailKey: null,
    isFavorited: false,
    favoriteCount: 0,
    commentCount: 0,
    createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z",
    ingredientGroups: [
      {
        name: null,
        ingredients: [
          { name: "材料", quantity: null, unit: null, placement: "suffix", refRecipe: null },
        ],
      },
    ],
    steps: [{ body: "作る", imageUrl: null, imageKey: null }],
  };
}

describe("useRecipeForm recipe 再取得同期", () => {
  it("未編集なら stale cache から最新 recipe へ同期する", async () => {
    const oldRecipe = recipe("古いタイトル");
    const newRecipe = recipe("最新タイトル");
    const { result, rerender } = await renderHook(
      ({ value }: { value: RecipeResponse }) => useRecipeForm(value),
      {
        initialProps: { value: oldRecipe },
      },
    );

    await rerender({ value: newRecipe });

    await waitFor(() => {
      expect(result.current.state.title).toBe("最新タイトル");
      expect(result.current.baseline.title).toBe("最新タイトル");
      expect(result.current.dirty).toBe(false);
    });
  });

  it("編集中は再取得でローカル入力を上書きしない", async () => {
    const oldRecipe = recipe("古いタイトル");
    const newRecipe = recipe("サーバーの最新タイトル");
    const { result, rerender } = await renderHook(
      ({ value }: { value: RecipeResponse }) => useRecipeForm(value),
      {
        initialProps: { value: oldRecipe },
      },
    );

    await act(async () => {
      result.current.dispatch({ type: "setField", field: "title", value: "入力中のタイトル" });
    });
    await rerender({ value: newRecipe });

    await waitFor(() => expect(result.current.dirty).toBe(true));
    expect(result.current.state.title).toBe("入力中のタイトル");
    expect(result.current.baseline.title).toBe("古いタイトル");
  });

  it("編集内容を元に戻すと保留中の最新 recipe へ同期する", async () => {
    const oldRecipe = recipe("古いタイトル");
    const newRecipe = recipe("サーバーの最新タイトル");
    const { result, rerender } = await renderHook(
      ({ value }: { value: RecipeResponse }) => useRecipeForm(value),
      {
        initialProps: { value: oldRecipe },
      },
    );

    await act(async () => {
      result.current.dispatch({ type: "setField", field: "title", value: "入力中のタイトル" });
    });
    await rerender({ value: newRecipe });

    await act(async () => {
      result.current.dispatch({ type: "setField", field: "title", value: "古いタイトル" });
    });

    await waitFor(() => {
      expect(result.current.state.title).toBe("サーバーの最新タイトル");
      expect(result.current.baseline.title).toBe("サーバーの最新タイトル");
      expect(result.current.dirty).toBe(false);
    });
  });
});
