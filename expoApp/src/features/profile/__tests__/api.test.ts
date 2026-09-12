/**
 * features/profile/api.ts の単体テスト。`@/api/client` を差し替えて分岐を確かめる。
 */
import { api } from "@/api/client";

import { deleteAvatar, getMyProfile, getUser, putAvatar, updateMe } from "../api";

jest.mock("@/api/client", () => ({
  api: { GET: jest.fn(), PATCH: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() },
}));

const mockGet = api.GET as jest.Mock;
const mockPatch = api.PATCH as jest.Mock;
const mockPut = api.PUT as jest.Mock;
const mockDelete = api.DELETE as jest.Mock;

const selfProfile = {
  id: "u1",
  displayName: "テスト太郎",
  email: "testuser_001@example.com",
  avatarUrl: null,
  followingCount: 0,
  followerCount: 0,
  isFollowing: null,
  emailPublic: false,
  xUrl: null,
  xPublic: false,
  instagramUrl: null,
  instagramPublic: false,
  otherUrl: null,
  otherPublic: false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getUser / getMyProfile", () => {
  it("パスに user_id を入れて取得する", async () => {
    mockGet.mockResolvedValue({ data: selfProfile, response: { status: 200 } });
    await expect(getUser("u1")).resolves.toEqual(selfProfile);
    expect(mockGet).toHaveBeenCalledWith("/api/v1/users/{user_id}", {
      params: { path: { user_id: "u1" } },
    });
  });

  it("404 は ApiError（サーバーのメッセージ）", async () => {
    mockGet.mockResolvedValue({
      error: { error: { code: "NOT_FOUND", message: "見つかりません" } },
      response: { status: 404 },
    });
    await expect(getUser("x")).rejects.toMatchObject({ status: 404, message: "見つかりません" });
  });

  it("本文が無い失敗は既定メッセージ", async () => {
    mockGet.mockResolvedValue({ response: { status: 500 } });
    await expect(getUser("x")).rejects.toMatchObject({ message: "読み込みに失敗しました" });
  });

  it("自分の取得で他人向けの形が返ったらエラーにする", async () => {
    mockGet.mockResolvedValue({
      data: { id: "u1", displayName: "A", avatarUrl: null, links: {} },
      response: { status: 200 },
    });
    await expect(getMyProfile("u1")).rejects.toMatchObject({ status: 500 });
  });

  it("自分の取得は本人向けの形をそのまま返す", async () => {
    mockGet.mockResolvedValue({ data: selfProfile, response: { status: 200 } });
    await expect(getMyProfile("u1")).resolves.toEqual(selfProfile);
  });
});

describe("updateMe", () => {
  it("送った body で PATCH する", async () => {
    mockPatch.mockResolvedValue({ data: selfProfile, response: { status: 200 } });
    await updateMe({ xUrl: null });
    expect(mockPatch).toHaveBeenCalledWith("/api/v1/users/me", { body: { xUrl: null } });
  });

  it("400 は details 付きの ApiError", async () => {
    const details = { errors: [{ loc: ["body", "xUrl"], msg: "不正" }] };
    mockPatch.mockResolvedValue({
      error: { error: { code: "VALIDATION_ERROR", message: "不正です", details } },
      response: { status: 400 },
    });
    await expect(updateMe({ xUrl: "bad" })).rejects.toMatchObject({ status: 400, details });
  });

  it("本文が無い失敗は既定メッセージ", async () => {
    mockPatch.mockResolvedValue({ response: { status: 500 } });
    await expect(updateMe({})).rejects.toMatchObject({ message: "保存に失敗しました" });
  });
});

describe("putAvatar / deleteAvatar", () => {
  it("FormData に file を入れて PUT し、avatarUrl を返す", async () => {
    mockPut.mockResolvedValue({
      data: { avatarUrl: "https://example.com/a.jpg" },
      response: { status: 200 },
    });
    const file = new Blob(["x"], { type: "image/jpeg" });
    await expect(putAvatar(file)).resolves.toEqual({ avatarUrl: "https://example.com/a.jpg" });

    const options = mockPut.mock.calls[0][1] as {
      body: { file: unknown };
      bodySerializer: (b: { file: unknown }) => FormData;
    };
    const form = options.bodySerializer(options.body);
    expect(form.get("file")).toBeTruthy();
  });

  it("PUT の失敗は既定メッセージ", async () => {
    mockPut.mockResolvedValue({ response: { status: 500 } });
    await expect(putAvatar(new Blob(["x"]))).rejects.toMatchObject({
      message: "画像のアップロードに失敗しました",
    });
  });

  it("DELETE は成功で何も返さない / 失敗で ApiError", async () => {
    mockDelete.mockResolvedValueOnce({ response: { status: 204 } });
    await expect(deleteAvatar()).resolves.toBeUndefined();

    mockDelete.mockResolvedValueOnce({ error: {}, response: { status: 500 } });
    await expect(deleteAvatar()).rejects.toMatchObject({ message: "画像の削除に失敗しました" });
  });
});
