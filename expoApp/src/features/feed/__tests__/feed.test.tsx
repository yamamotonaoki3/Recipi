/**
 * ホームフィードの API と hooks のテスト（Issue #98）。
 *
 * API: `feed` と `q` の送り方（既定は all・空の q は送らない）。
 * hooks: タブ（feed）ごとに別のキャッシュ、ルートキーでまとめて無効化できる。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { api } from "@/api/client";
import { useSession } from "@/store/session";

import { listFeed } from "../api";
import { FEED_ROOT_KEY, feedKeys, useFeed } from "../hooks";

jest.mock("@/api/client", () => ({ api: { GET: jest.fn() } }));

const mockGet = api.GET as jest.Mock;
const page = { items: [], nextCursor: null };

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().clear();
  useSession.setState({ hydrated: true, isAuthenticated: true });
  mockGet.mockResolvedValue({ data: page, response: { status: 200 } });
});

describe("listFeed", () => {
  it("feed を省略すると all を送る", async () => {
    await listFeed({});
    expect(mockGet).toHaveBeenCalledWith("/api/v1/recipes", {
      params: { query: { feed: "all", q: undefined, cursor: undefined, limit: undefined } },
    });
  });

  it.each(["following", "followers"] as const)(
    "feed=%s をそのまま送り、q と併用できる",
    async (feed) => {
      await listFeed({ feed, q: "玉ねぎ", cursor: "c1", limit: 20 });
      expect(mockGet).toHaveBeenCalledWith("/api/v1/recipes", {
        params: { query: { feed, q: "玉ねぎ", cursor: "c1", limit: 20 } },
      });
    },
  );

  it("空の q と空のカーソルは送らない", async () => {
    await listFeed({ feed: "following", q: "", cursor: "" });
    expect(mockGet).toHaveBeenCalledWith("/api/v1/recipes", {
      params: { query: { feed: "following", q: undefined, cursor: undefined, limit: undefined } },
    });
  });

  it("失敗は ApiError（本文が無ければ既定メッセージ）", async () => {
    mockGet.mockResolvedValueOnce({
      error: { error: { code: "VALIDATION_ERROR", message: "不正な feed" } },
      response: { status: 400 },
    });
    await expect(listFeed({ feed: "following" })).rejects.toMatchObject({
      status: 400,
      message: "不正な feed",
    });

    mockGet.mockResolvedValueOnce({ response: { status: 500 } });
    await expect(listFeed({})).rejects.toMatchObject({ message: "通信エラーが発生しました" });
  });
});

describe("useFeed", () => {
  it("タブ（feed）ごとに別のキャッシュに入る", async () => {
    const { result: all } = await renderHook(() => useFeed("all"), { wrapper });
    const { result: following } = await renderHook(() => useFeed("following"), { wrapper });
    await waitFor(() => expect(all.current.isSuccess && following.current.isSuccess).toBe(true));

    expect(client.getQueryData(feedKeys.list("all", ""))).toBeDefined();
    expect(client.getQueryData(feedKeys.list("following", ""))).toBeDefined();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("enabled: false なら送らない", async () => {
    await renderHook(() => useFeed("followers", "", { enabled: false }), { wrapper });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("ルートキーで無効化すると、どのタブも取り直す", async () => {
    const { result: all } = await renderHook(() => useFeed("all"), { wrapper });
    const { result: followers } = await renderHook(() => useFeed("followers"), { wrapper });
    await waitFor(() => expect(all.current.isSuccess && followers.current.isSuccess).toBe(true));
    mockGet.mockClear();

    await act(async () => {
      await client.invalidateQueries({ queryKey: FEED_ROOT_KEY });
    });

    const feeds = mockGet.mock.calls.map(
      ([, opts]) => (opts as { params: { query: { feed: string } } }).params.query.feed,
    );
    expect(feeds.sort()).toEqual(["all", "followers"]);
  });
});
