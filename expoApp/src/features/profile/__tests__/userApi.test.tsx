/**
 * 他人のプロフィール・レシピ一覧の API と hooks のテスト（Issue #96）。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { api } from "@/api/client";
import { useSession } from "@/store/session";

import { listUserRecipes } from "../api";
import { useUserProfile, useUserRecipes } from "../userHooks";

jest.mock("@/api/client", () => ({ api: { GET: jest.fn() } }));

const mockGet = api.GET as jest.Mock;

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function login() {
  useSession.getState().setAuth({
    accessToken: "a",
    refreshToken: "r",
    user: { id: "u1", displayName: "testuser_001" },
    rememberMe: false,
  });
  useSession.getState().setHydrated(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().clear();
  useSession.getState().setHydrated(false);
});

describe("listUserRecipes", () => {
  it("パスとカーソルを渡して 1 ページ取る", async () => {
    const page = { items: [], nextCursor: null };
    mockGet.mockResolvedValue({ data: page, response: { status: 200 } });

    await expect(listUserRecipes("u2", { cursor: "c1", limit: 20 })).resolves.toEqual(page);
    expect(mockGet).toHaveBeenCalledWith("/api/v1/users/{user_id}/recipes", {
      params: { path: { user_id: "u2" }, query: { cursor: "c1", limit: 20 } },
    });
  });

  it("404 はサーバーのメッセージ、本文が無い失敗は既定メッセージ", async () => {
    mockGet.mockResolvedValueOnce({
      error: { error: { code: "NOT_FOUND", message: "見つかりません" } },
      response: { status: 404 },
    });
    await expect(listUserRecipes("x")).rejects.toMatchObject({ status: 404 });

    mockGet.mockResolvedValueOnce({ response: { status: 500 } });
    await expect(listUserRecipes("x")).rejects.toMatchObject({
      message: "読み込みに失敗しました",
    });
  });
});

describe("useUserProfile / useUserRecipes", () => {
  it("セッション復元前は送らない", async () => {
    await renderHook(() => useUserProfile("u2"), { wrapper });
    await renderHook(() => useUserRecipes("u2"), { wrapper });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("ID が無いときは送らない", async () => {
    // 復元前に描画した hook が残っていると、ログイン後に正しく取得を始めてしまうので、
    // このテストはログインしてから描画する。
    login();
    await renderHook(() => useUserProfile(undefined), { wrapper });
    await renderHook(() => useUserRecipes(undefined), { wrapper });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("プロフィールを取得する", async () => {
    login();
    const profile = { id: "u2", displayName: "testuser_002", links: {} };
    mockGet.mockResolvedValue({ data: profile, response: { status: 200 } });

    const { result } = await renderHook(() => useUserProfile("u2"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(profile));
  });

  it("レシピ一覧は次ページのカーソルで続きを取る", async () => {
    login();
    mockGet
      .mockResolvedValueOnce({ data: { items: [], nextCursor: "c2" }, response: { status: 200 } })
      .mockResolvedValueOnce({ data: { items: [], nextCursor: null }, response: { status: 200 } });

    const { result } = await renderHook(() => useUserRecipes("u2"), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mockGet).toHaveBeenLastCalledWith("/api/v1/users/{user_id}/recipes", {
      params: { path: { user_id: "u2" }, query: { cursor: "c2", limit: 20 } },
    });
    // 次ページの取得後の再描画を待ってから読む（直後は古い値のまま）。
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
});
