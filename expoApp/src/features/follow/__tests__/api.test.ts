/**
 * features/follow/api.ts の単体テスト。`@/api/client` を差し替えて分岐を確かめる。
 */
import { api } from "@/api/client";

import { followUser, listConnections, unfollowUser } from "../api";

jest.mock("@/api/client", () => ({
  api: { GET: jest.fn(), POST: jest.fn(), DELETE: jest.fn() },
}));

const mockGet = api.GET as jest.Mock;
const mockPost = api.POST as jest.Mock;
const mockDelete = api.DELETE as jest.Mock;

const page = {
  items: [{ id: "u2", displayName: "testuser_002", avatarUrl: null, isFollowing: true }],
  nextCursor: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("followUser / unfollowUser", () => {
  it("パスに user_id を入れて送り、成功なら何も返さない", async () => {
    mockPost.mockResolvedValue({ response: { status: 204 } });
    mockDelete.mockResolvedValue({ response: { status: 204 } });

    await expect(followUser("u2")).resolves.toBeUndefined();
    await expect(unfollowUser("u2")).resolves.toBeUndefined();

    expect(mockPost).toHaveBeenCalledWith("/api/v1/users/{user_id}/follow", {
      params: { path: { user_id: "u2" } },
    });
    expect(mockDelete).toHaveBeenCalledWith("/api/v1/users/{user_id}/follow", {
      params: { path: { user_id: "u2" } },
    });
  });

  it("自分をフォローしようとした 400 はサーバーのメッセージ", async () => {
    mockPost.mockResolvedValue({
      error: { error: { code: "VALIDATION_ERROR", message: "自分はフォローできません" } },
      response: { status: 400 },
    });
    await expect(followUser("u1")).rejects.toMatchObject({
      status: 400,
      message: "自分はフォローできません",
    });
  });

  it("本文が無い失敗は既定メッセージ", async () => {
    mockPost.mockResolvedValue({ error: {}, response: { status: 500 } });
    mockDelete.mockResolvedValue({ error: {}, response: { status: 500 } });
    await expect(followUser("u2")).rejects.toMatchObject({ message: "フォローに失敗しました" });
    await expect(unfollowUser("u2")).rejects.toMatchObject({
      message: "フォロー解除に失敗しました",
    });
  });
});

describe("listConnections", () => {
  it.each([
    ["me", "following", "/api/v1/users/me/following", undefined],
    ["me", "followers", "/api/v1/users/me/followers", undefined],
    ["u2", "following", "/api/v1/users/{user_id}/following", { user_id: "u2" }],
    ["u2", "followers", "/api/v1/users/{user_id}/followers", { user_id: "u2" }],
  ] as const)("%s の %s は %s を呼ぶ", async (target, tab, path, pathParams) => {
    mockGet.mockResolvedValue({ data: page, response: { status: 200 } });

    await expect(listConnections(target, tab, { cursor: "c1", limit: 20 })).resolves.toEqual(page);

    const expectedParams = pathParams
      ? { query: { cursor: "c1", limit: 20 }, path: pathParams }
      : { query: { cursor: "c1", limit: 20 } };
    expect(mockGet).toHaveBeenCalledWith(path, { params: expectedParams });
  });

  it("空のカーソルは送らない", async () => {
    mockGet.mockResolvedValue({ data: page, response: { status: 200 } });
    await listConnections("me", "following", { cursor: "" });
    expect(mockGet).toHaveBeenCalledWith("/api/v1/users/me/following", {
      params: { query: { cursor: undefined, limit: undefined } },
    });
  });

  it("404 は ApiError、本文が無い失敗は既定メッセージ", async () => {
    mockGet.mockResolvedValueOnce({
      error: { error: { code: "NOT_FOUND", message: "見つかりません" } },
      response: { status: 404 },
    });
    await expect(listConnections("x", "followers")).rejects.toMatchObject({ status: 404 });

    mockGet.mockResolvedValueOnce({ response: { status: 500 } });
    await expect(listConnections("me", "followers")).rejects.toMatchObject({
      message: "読み込みに失敗しました",
    });
  });
});
