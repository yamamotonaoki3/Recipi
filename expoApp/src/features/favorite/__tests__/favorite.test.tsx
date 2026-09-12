/**
 * お気に入りの API と hooks のテスト（Issue #100）。
 *
 * API: パスと 204、失敗時の ApiError。
 * hooks（WB）: 楽観更新（詳細・一覧のそのレシピの行だけ）、状態が変わるときだけ数が動く、
 * 失敗時はそのレシピだけ戻す（別レシピの楽観更新は残る）、ユーザー切替時は書かない。
 */
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { api } from "@/api/client";
import { feedKeys } from "@/features/feed/hooks";
import { historyKeys } from "@/features/history/hooks";
import { recipeKeys } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

import { favoriteRecipe, unfavoriteRecipe } from "../api";
import { useToggleFavorite } from "../hooks";

jest.mock("@/api/client", () => ({ api: { POST: jest.fn(), DELETE: jest.fn() } }));

const mockPost = api.POST as jest.Mock;
const mockDelete = api.DELETE as jest.Mock;

type Row = { id: string; isFavorited: boolean; favoriteCount: number };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function login(id = "u1") {
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id, displayName: "testuser" },
    rememberMe: false,
  });
  useSession.getState().setHydrated(true);
}

function page(items: Row[]): InfiniteData<{ items: Row[]; nextCursor: null }> {
  return { pages: [{ items, nextCursor: null }], pageParams: [undefined] };
}

/** 解決を外から操作できる Promise（楽観更新の途中の状態を確かめるため）。 */
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const feedKey = feedKeys.list("all", "");
const historyKey = historyKeys.list("u1");

function seed() {
  client.setQueryData(recipeKeys.detail("r1"), {
    id: "r1",
    title: "レシピ1",
    isFavorited: false,
    favoriteCount: 3,
  });
  client.setQueryData(
    feedKey,
    page([
      { id: "r1", isFavorited: false, favoriteCount: 3 },
      { id: "r2", isFavorited: false, favoriteCount: 5 },
    ]),
  );
  client.setQueryData(historyKey, page([{ id: "r1", isFavorited: false, favoriteCount: 3 }]));
}

const detailOf = (id: string) => client.getQueryData<Row>(recipeKeys.detail(id));
const feedRow = (id: string) =>
  client
    .getQueryData<InfiniteData<{ items: Row[] }>>(feedKey)
    ?.pages[0].items.find((r) => r.id === id);
const historyRow = (id: string) =>
  client
    .getQueryData<InfiniteData<{ items: Row[] }>>(historyKey)
    ?.pages[0].items.find((r) => r.id === id);

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  useSession.getState().clear();
  useSession.getState().setHydrated(false);
});

describe("favoriteRecipe / unfavoriteRecipe", () => {
  it("パスに recipe_id を入れて送り、成功なら何も返さない", async () => {
    mockPost.mockResolvedValue({ response: { status: 204, ok: true } });
    mockDelete.mockResolvedValue({ response: { status: 204, ok: true } });

    await expect(favoriteRecipe("r1")).resolves.toBeUndefined();
    await expect(unfavoriteRecipe("r1")).resolves.toBeUndefined();

    const opts = { params: { path: { recipe_id: "r1" } } };
    expect(mockPost).toHaveBeenCalledWith("/api/v1/recipes/{recipe_id}/favorite", opts);
    expect(mockDelete).toHaveBeenCalledWith("/api/v1/recipes/{recipe_id}/favorite", opts);
  });

  it("404 はサーバーのメッセージ、本文が無い失敗は既定メッセージ", async () => {
    mockPost.mockResolvedValueOnce({
      error: { error: { code: "NOT_FOUND", message: "見つかりません" } },
      response: { status: 404, ok: false },
    });
    await expect(favoriteRecipe("x")).rejects.toMatchObject({ status: 404 });

    mockPost.mockResolvedValueOnce({ error: {}, response: { status: 500 } });
    await expect(favoriteRecipe("x")).rejects.toMatchObject({
      message: "お気に入りに追加できませんでした",
    });
    mockDelete.mockResolvedValueOnce({ error: {}, response: { status: 500 } });
    await expect(unfavoriteRecipe("x")).rejects.toMatchObject({
      message: "お気に入りを解除できませんでした",
    });
  });

  it("本文なしの 502 でも失敗にする", async () => {
    mockPost.mockResolvedValueOnce({ error: undefined, response: { status: 502, ok: false } });
    await expect(favoriteRecipe("x")).rejects.toMatchObject({
      message: "お気に入りに追加できませんでした",
      status: 502,
    });

    mockDelete.mockResolvedValueOnce({ error: undefined, response: { status: 502, ok: false } });
    await expect(unfavoriteRecipe("x")).rejects.toMatchObject({
      message: "お気に入りを解除できませんでした",
      status: 502,
    });
  });
});

describe("useToggleFavorite（楽観更新）", () => {
  it("返事を待たずに、詳細と一覧の「そのレシピ」だけハートと数を変える", async () => {
    login();
    seed();
    const pending = deferred();
    mockPost.mockReturnValue(pending.promise.then(() => ({ response: { status: 204, ok: true } })));

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      result.current.mutate({ recipeId: "r1", favorite: true });
    });

    await waitFor(() => expect(detailOf("r1")?.isFavorited).toBe(true));
    expect(detailOf("r1")?.favoriteCount).toBe(4);
    expect(feedRow("r1")).toMatchObject({ isFavorited: true, favoriteCount: 4 });
    expect(historyRow("r1")).toMatchObject({ isFavorited: true, favoriteCount: 4 });
    // 別のレシピ（r2）には触れない。
    expect(feedRow("r2")).toMatchObject({ isFavorited: false, favoriteCount: 5 });

    await act(async () => {
      pending.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("解除は数を 1 減らし、解除の API を呼ぶ", async () => {
    login();
    seed();
    client.setQueryData(recipeKeys.detail("r1"), {
      id: "r1",
      isFavorited: true,
      favoriteCount: 3,
    });
    mockDelete.mockResolvedValue({ response: { status: 204, ok: true } });

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recipeId: "r1", favorite: false });
    });

    expect(mockDelete).toHaveBeenCalled();
    expect(detailOf("r1")).toMatchObject({ isFavorited: false, favoriteCount: 2 });
  });

  it("既に同じ状態なら数を動かさない（冪等な API でも数がずれない）", async () => {
    login();
    seed();
    client.setQueryData(recipeKeys.detail("r1"), {
      id: "r1",
      isFavorited: true,
      favoriteCount: 3,
    });
    client.setQueryData(
      feedKey,
      page([
        { id: "r1", isFavorited: true, favoriteCount: 3 },
        { id: "r2", isFavorited: false, favoriteCount: 5 },
      ]),
    );
    client.setQueryData(historyKey, page([{ id: "r1", isFavorited: true, favoriteCount: 3 }]));
    mockPost.mockResolvedValue({ response: { status: 204, ok: true } });

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recipeId: "r1", favorite: true });
    });

    expect(detailOf("r1")?.favoriteCount).toBe(3);
    expect(feedRow("r1")?.favoriteCount).toBe(3);
  });

  it("詳細は未登録で一覧の行は登録済みでも、登録時は詳細だけ数を 1 増やす", async () => {
    login();
    seed();
    client.setQueryData(
      feedKey,
      page([
        { id: "r1", isFavorited: true, favoriteCount: 3 },
        { id: "r2", isFavorited: false, favoriteCount: 5 },
      ]),
    );
    client.setQueryData(historyKey, page([{ id: "r1", isFavorited: true, favoriteCount: 3 }]));
    const pending = deferred();
    mockPost.mockReturnValue(pending.promise.then(() => ({ response: { status: 204, ok: true } })));

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      result.current.mutate({ recipeId: "r1", favorite: true });
    });

    await waitFor(() => expect(detailOf("r1")?.isFavorited).toBe(true));
    expect(detailOf("r1")?.favoriteCount).toBe(4);
    expect(feedRow("r1")).toMatchObject({ isFavorited: true, favoriteCount: 3 });
    expect(historyRow("r1")).toMatchObject({ isFavorited: true, favoriteCount: 3 });

    await act(async () => {
      pending.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("詳細が無くても一覧の行から押す前の状態を読み、数を動かす", async () => {
    login();
    client.setQueryData(feedKey, page([{ id: "r1", isFavorited: false, favoriteCount: 3 }]));
    mockPost.mockReturnValue(new Promise(() => undefined));

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      result.current.mutate({ recipeId: "r1", favorite: true });
    });

    await waitFor(() =>
      expect(feedRow("r1")).toMatchObject({ isFavorited: true, favoriteCount: 4 }),
    );
  });

  it("失敗したら、そのレシピだけ元に戻す（別のレシピの楽観更新は残る）", async () => {
    login();
    seed();
    const r1 = deferred();
    const r2 = deferred();
    mockPost.mockImplementation(
      (_path: string, opts: { params: { path: { recipe_id: string } } }) =>
        (opts.params.path.recipe_id === "r1" ? r1.promise : r2.promise).then(() => ({
          response: { status: 204, ok: true },
        })),
    );

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      result.current.mutate({ recipeId: "r1", favorite: true });
      result.current.mutate({ recipeId: "r2", favorite: true });
    });
    await waitFor(() => expect(feedRow("r2")?.isFavorited).toBe(true));

    await act(async () => {
      r1.reject(new Error("network"));
    });

    await waitFor(() =>
      expect(feedRow("r1")).toMatchObject({ isFavorited: false, favoriteCount: 3 }),
    );
    expect(detailOf("r1")).toMatchObject({ isFavorited: false, favoriteCount: 3 });
    // r2 は失敗していないので、楽観更新のまま。
    expect(feedRow("r2")).toMatchObject({ isFavorited: true, favoriteCount: 6 });
  });

  it("途中でユーザーが入れ替わったら、巻き戻しも張り替えもしない", async () => {
    login("u1");
    seed();
    const pending = deferred();
    mockPost.mockReturnValue(pending.promise.then(() => ({ response: { status: 204, ok: true } })));
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      result.current.mutate({ recipeId: "r1", favorite: true });
    });
    await waitFor(() => expect(detailOf("r1")?.isFavorited).toBe(true));

    login("u9");
    await act(async () => {
      pending.reject(new Error("network"));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(detailOf("r1")?.isFavorited).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("成功したら、詳細とすべての一覧を張り替える", async () => {
    login();
    seed();
    mockPost.mockResolvedValue({ response: { status: 204, ok: true } });
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recipeId: "r1", favorite: true });
    });

    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        recipeKeys.detail("r1"),
        ["feed"],
        ["history"],
        ["my-recipes"],
        ["user-recipes"],
      ]),
    );
  });

  it("user が無くても楽観更新する", async () => {
    useSession.getState().setAuth({
      accessToken: "a",
      refreshToken: "r",
      user: null,
      rememberMe: false,
    });
    useSession.getState().setHydrated(true);
    seed();
    mockPost.mockResolvedValue({ response: { status: 204, ok: true } });

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recipeId: "r1", favorite: true });
    });

    expect(feedRow("r1")).toMatchObject({ isFavorited: true, favoriteCount: 4 });
  });

  it("2件進行中でも完了したレシピの詳細は invalidate し、一覧は両方終わってから invalidate する", async () => {
    login();
    seed();
    const r1 = deferred();
    const r2 = deferred();
    mockPost.mockImplementation(
      (_path: string, opts: { params: { path: { recipe_id: string } } }) =>
        (opts.params.path.recipe_id === "r1" ? r1.promise : r2.promise).then(() => ({
          response: { status: 204, ok: true },
        })),
    );
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useToggleFavorite(), { wrapper });
    let first: Promise<void>;
    let second: Promise<void>;
    await act(async () => {
      first = result.current.mutateAsync({ recipeId: "r1", favorite: true });
      second = result.current.mutateAsync({ recipeId: "r2", favorite: true });
    });
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));

    await act(async () => {
      r1.resolve();
      await first;
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenNthCalledWith(1, { queryKey: recipeKeys.detail("r1") });

    await act(async () => {
      r2.resolve();
      await second;
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(6));
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        recipeKeys.detail("r1"),
        recipeKeys.detail("r2"),
        ["feed"],
        ["history"],
        ["my-recipes"],
        ["user-recipes"],
      ]),
    );
  });
});
