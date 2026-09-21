import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { deleteRecipe } from "../api";
import { FEED_ROOT_KEY } from "@/features/feed/hooks";
import { HISTORY_ROOT_KEY } from "@/features/history/hooks";
import { recipeKeys, useDeleteRecipe } from "../hooks";
import { unmarkRecipeDeleted } from "../deletionState";

jest.mock("../api", () => ({
  createRecipe: jest.fn(),
  deleteRecipe: jest.fn(),
  getRecipe: jest.fn(),
  getUnits: jest.fn(),
  listMyRecipes: jest.fn(),
  updateRecipe: jest.fn(),
}));

const mockDeleteRecipe = deleteRecipe as jest.MockedFunction<typeof deleteRecipe>;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useDeleteRecipe", () => {
  let client: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    unmarkRecipeDeleted("r1");
  });

  it("削除成功時に感想一覧をキャンセル・破棄し、既存キャッシュも更新する", async () => {
    mockDeleteRecipe.mockResolvedValue(undefined);
    client.setQueryData(["comments", "r1"], { pages: [], pageParams: [] });
    const cancel = jest.spyOn(client, "cancelQueries").mockResolvedValue();
    const remove = jest.spyOn(client, "removeQueries");
    const invalidate = jest.spyOn(client, "invalidateQueries").mockResolvedValue();

    const { result } = await renderHook(() => useDeleteRecipe(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync("r1");
    });

    expect(client.getQueryData(["deleted-recipe", "r1"])).toBe(true);
    expect(cancel).toHaveBeenCalledWith({ queryKey: ["comments", "r1"] });
    expect(remove).toHaveBeenCalledWith({ queryKey: ["comments", "r1"] });
    expect(remove).toHaveBeenCalledWith({ queryKey: recipeKeys.detail("r1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["my-recipes"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: FEED_ROOT_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: HISTORY_ROOT_KEY });
    expect(client.getQueryData(["comments", "r1"])).toBeUndefined();
  });

  it("削除失敗時は感想一覧キャッシュを変更しない", async () => {
    const failure = new Error("delete failed");
    mockDeleteRecipe.mockRejectedValue(failure);
    const cached = { pages: [], pageParams: [] };
    client.setQueryData(["comments", "r1"], cached);
    const cancel = jest.spyOn(client, "cancelQueries");
    const remove = jest.spyOn(client, "removeQueries");

    const { result } = await renderHook(() => useDeleteRecipe(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await expect(result.current.mutateAsync("r1")).rejects.toThrow("delete failed");
    });

    expect(cancel).toHaveBeenCalledWith({ queryKey: ["comments", "r1"] });
    expect(remove).not.toHaveBeenCalledWith({ queryKey: ["comments", "r1"] });
    expect(client.getQueryData(["comments", "r1"])).toBe(cached);
    expect(client.getQueryData(["deleted-recipe", "r1"])).toBeUndefined();
  });
});
