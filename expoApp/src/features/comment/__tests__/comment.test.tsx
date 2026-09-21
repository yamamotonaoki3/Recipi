/**
 * 感想の API と hooks のテスト（Issue #102）。
 *
 * API: パス・body・成功時の値、本文の無い失敗も失敗にする（lessons #100-1）。
 * hooks（WB）: 投稿で先頭に追加・感想数 +1、編集で置き換え、削除で除去・−1、
 * ユーザーが入れ替わったら書かない、最後に一覧と詳細を取り直す。
 */
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { api } from "@/api/client";
import { recipeKeys } from "@/features/recipe/hooks";
import { useSession } from "@/store/session";

import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
  type Comment,
  type CommentList,
} from "../api";
import {
  commentKeys,
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from "../hooks";

jest.mock("@/api/client", () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn(), DELETE: jest.fn() },
}));

const mockGet = api.GET as jest.Mock;
const mockPost = api.POST as jest.Mock;
const mockPatch = api.PATCH as jest.Mock;
const mockDelete = api.DELETE as jest.Mock;

const ok = (status: number, data?: unknown) => ({ data, response: { ok: true, status } });

function makeComment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    body: `[E2E_TEST] 感想 ${id}`,
    imageUrl: null,
    author: { id: "u1", displayName: "testuser_001", avatarUrl: null },
    createdAt: "2026-09-12T00:00:00Z",
    updatedAt: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

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

/** 感想一覧（1 ページ）とレシピ詳細（感想数）をキャッシュに入れておく。 */
function seed(items: Comment[], commentCount = items.length) {
  client.setQueryData<InfiniteData<CommentList, string | undefined>>(commentKeys.list("r1"), {
    pages: [{ items, nextCursor: null }],
    pageParams: [undefined],
  });
  client.setQueryData(recipeKeys.detail("r1"), { id: "r1", commentCount });
}

const listed = () =>
  client
    .getQueryData<InfiniteData<CommentList>>(commentKeys.list("r1"))
    ?.pages[0].items.map((c) => c.id);
const countOf = () =>
  client.getQueryData<{ commentCount: number }>(recipeKeys.detail("r1"))?.commentCount;

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  useSession.getState().clear();
  useSession.getState().setHydrated(false);
});

describe("感想の API", () => {
  it("一覧・投稿・編集・削除を正しいパスと body で送る", async () => {
    const list = { items: [makeComment("c1")], nextCursor: null };
    mockGet.mockResolvedValue(ok(200, list));
    mockPost.mockResolvedValue(ok(201, makeComment("c2")));
    mockPatch.mockResolvedValue(ok(200, makeComment("c1", { body: "直した" })));
    mockDelete.mockResolvedValue(ok(204));

    await expect(listComments("r1", { cursor: "x", limit: 20 })).resolves.toEqual(list);
    expect(mockGet).toHaveBeenCalledWith("/api/v1/recipes/{recipe_id}/comments", {
      params: { path: { recipe_id: "r1" }, query: { cursor: "x", limit: 20 } },
    });

    await expect(createComment("r1", { body: "おいしい", imageKey: "k1" })).resolves.toMatchObject({
      id: "c2",
    });
    expect(mockPost).toHaveBeenCalledWith("/api/v1/recipes/{recipe_id}/comments", {
      params: { path: { recipe_id: "r1" } },
      body: { body: "おいしい", imageKey: "k1" },
    });

    await expect(updateComment("c1", { imageKey: null })).resolves.toMatchObject({
      body: "直した",
    });
    expect(mockPatch).toHaveBeenCalledWith("/api/v1/comments/{comment_id}", {
      params: { path: { comment_id: "c1" } },
      body: { imageKey: null },
    });

    await expect(deleteComment("c1")).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith("/api/v1/comments/{comment_id}", {
      params: { path: { comment_id: "c1" } },
    });
  });

  it("403 はサーバーのメッセージ、本文の無い失敗（502）も既定メッセージで失敗にする", async () => {
    mockPost.mockResolvedValueOnce({
      error: { error: { code: "FORBIDDEN", message: "自分のレシピには感想を書けません" } },
      response: { ok: false, status: 403 },
    });
    await expect(createComment("r1", { body: "x" })).rejects.toMatchObject({
      status: 403,
      message: "自分のレシピには感想を書けません",
    });

    // 本文が無いと error は空になる。response.ok を見ないと成功扱いになってしまう。
    mockDelete.mockResolvedValueOnce({ error: undefined, response: { ok: false, status: 502 } });
    await expect(deleteComment("c1")).rejects.toMatchObject({
      status: 502,
      message: "感想を削除できませんでした",
    });
    mockGet.mockResolvedValueOnce({ error: undefined, response: { ok: false, status: 502 } });
    await expect(listComments("r1")).rejects.toMatchObject({
      message: "感想を読み込めませんでした",
    });
    mockPatch.mockResolvedValueOnce({ error: undefined, response: { ok: false, status: 500 } });
    await expect(updateComment("c1", { body: "x" })).rejects.toMatchObject({
      message: "感想を保存できませんでした",
    });
  });
});

describe("感想の hooks", () => {
  it("未ログインでも、セッション復元後は感想一覧を取得する", async () => {
    useSession.getState().setHydrated(true);
    mockGet.mockResolvedValue(ok(200, { items: [makeComment("c1")], nextCursor: null }));

    const { result } = await renderHook(() => useComments("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith("/api/v1/recipes/{recipe_id}/comments", {
      params: { path: { recipe_id: "r1" }, query: { cursor: undefined, limit: 20 } },
    });
    expect(result.current.data?.pages[0].items).toHaveLength(1);
  });

  it("削除済みレシピの感想一覧は再取得しない", async () => {
    useSession.getState().setHydrated(true);
    client.setQueryData(["deleted-recipe", "r1"], true);

    const { result } = await renderHook(() => useComments("r1"), { wrapper });

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("投稿に成功したら一覧の先頭に足し、感想数を +1 して、最後に取り直す", async () => {
    login();
    seed([makeComment("c1")]);
    mockPost.mockResolvedValue(ok(201, makeComment("c2")));
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useCreateComment("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ body: "おいしい", imageKey: null });
    });

    expect(listed()).toEqual(["c2", "c1"]);
    expect(countOf()).toBe(2);
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([commentKeys.list("r1"), recipeKeys.detail("r1")]));
  });

  it("投稿に失敗したら一覧も数も変えない", async () => {
    login();
    seed([makeComment("c1")]);
    mockPost.mockResolvedValue({
      error: { error: { code: "FORBIDDEN", message: "書けません" } },
      response: { ok: false, status: 403 },
    });

    const { result } = await renderHook(() => useCreateComment("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ body: "x", imageKey: null }).catch(() => undefined);
    });

    expect(listed()).toEqual(["c1"]);
    expect(countOf()).toBe(1);
  });

  it("編集に成功したら、その行だけサーバーの返した内容に置き換える", async () => {
    login();
    seed([makeComment("c1"), makeComment("c2")]);
    mockPatch.mockResolvedValue(ok(200, makeComment("c1", { body: "直した" })));

    const { result } = await renderHook(() => useUpdateComment("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ commentId: "c1", patch: { body: "直した" } });
    });

    const pages = client.getQueryData<InfiniteData<CommentList>>(commentKeys.list("r1"));
    expect(pages?.pages[0].items.map((c) => c.body)).toEqual(["直した", "[E2E_TEST] 感想 c2"]);
    expect(countOf()).toBe(2);
  });

  it("削除に成功したら一覧から除き、感想数を −1 する（一覧に無い感想なら数は動かさない）", async () => {
    login();
    seed([makeComment("c1"), makeComment("c2")]);
    mockDelete.mockResolvedValue(ok(204));

    const { result } = await renderHook(() => useDeleteComment("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ commentId: "c1" });
    });
    expect(listed()).toEqual(["c2"]);
    expect(countOf()).toBe(1);

    await act(async () => {
      await result.current.mutateAsync({ commentId: "unknown" });
    });
    expect(countOf()).toBe(1);
  });

  it("途中でユーザーが入れ替わったら、キャッシュを書き換えず取り直しもしない", async () => {
    login("u1");
    seed([makeComment("c1")]);
    let resolve: (value: unknown) => void = () => undefined;
    mockPost.mockReturnValue(new Promise((res) => (resolve = res)));
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const { result } = await renderHook(() => useCreateComment("r1"), { wrapper });
    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = result.current.mutateAsync({ body: "x", imageKey: null });
    });

    login("u9");
    await act(async () => {
      resolve(ok(201, makeComment("c2")));
      await pending;
    });

    expect(listed()).toEqual(["c1"]);
    expect(countOf()).toBe(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
