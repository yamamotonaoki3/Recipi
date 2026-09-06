/**
 * features/auth/api.ts の単体テスト。
 * `@/api/client` を jest.mock で差し替え、成功/エラー分岐を確認する。
 */
import { api } from "@/api/client";
import {
  ApiError,
  confirmPasswordReset,
  login,
  logout,
  requestPasswordReset,
  signup,
  updateMe,
} from "./api";

jest.mock("@/api/client", () => ({ api: { POST: jest.fn(), PATCH: jest.fn() } }));

const mockPost = api.POST as jest.Mock;
const mockPatch = api.PATCH as jest.Mock;

beforeEach(() => {
  mockPost.mockReset();
  mockPatch.mockReset();
});

describe("signup", () => {
  it("成功するとデータを返す", async () => {
    mockPost.mockResolvedValue({
      data: { user: { id: "u1", displayName: "太郎" }, accessToken: "a", refreshToken: "r" },
      error: undefined,
      response: { status: 201 },
    });
    const result = await signup({
      email: "testuser_030@example.com",
      password: "TestPass123!",
      displayName: "太郎",
      securityQuestion: "Q",
      securityAnswer: "A",
    });
    expect(result.accessToken).toBe("a");
  });

  it("409 で ApiError を投げる", async () => {
    mockPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: "CONFLICT", message: "重複しています" } },
      response: { status: 409 },
    });
    await expect(
      signup({
        email: "testuser_030@example.com",
        password: "TestPass123!",
        displayName: "太郎",
        securityQuestion: "Q",
        securityAnswer: "A",
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  });
});

describe("login", () => {
  it("成功するとデータを返す", async () => {
    mockPost.mockResolvedValue({
      data: { user: { id: "u1", displayName: "太郎" }, accessToken: "a", refreshToken: "r" },
      error: undefined,
      response: { status: 200 },
    });
    const result = await login({
      email: "testuser_030@example.com",
      password: "TestPass123!",
      rememberMe: false,
    });
    expect(result.user.displayName).toBe("太郎");
  });

  it("401 で ApiError を投げる", async () => {
    mockPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: "UNAUTHORIZED", message: "違います" } },
      response: { status: 401 },
    });
    await expect(
      login({ email: "testuser_030@example.com", password: "wrong", rememberMe: false }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("logout", () => {
  it("成功時は例外を投げない", async () => {
    mockPost.mockResolvedValue({ error: undefined, response: { status: 204 } });
    await expect(logout({ refreshToken: "r" })).resolves.toBeUndefined();
  });

  it("失敗時は ApiError を投げる", async () => {
    mockPost.mockResolvedValue({
      error: { error: { code: "UNAUTHORIZED", message: "失敗" } },
      response: { status: 401 },
    });
    await expect(logout({ refreshToken: "r" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("requestPasswordReset", () => {
  it("成功すると securityQuestion を返す", async () => {
    mockPost.mockResolvedValue({
      data: { securityQuestion: "Q" },
      error: undefined,
      response: { status: 200 },
    });
    const result = await requestPasswordReset({ email: "testuser_030@example.com" });
    expect(result.securityQuestion).toBe("Q");
  });

  it("404 で ApiError を投げる", async () => {
    mockPost.mockResolvedValue({
      data: undefined,
      error: { error: { code: "NOT_FOUND", message: "未登録" } },
      response: { status: 404 },
    });
    await expect(requestPasswordReset({ email: "testuser_030@example.com" })).rejects.toMatchObject(
      { status: 404 },
    );
  });
});

describe("confirmPasswordReset", () => {
  it("成功時は例外を投げない", async () => {
    mockPost.mockResolvedValue({ error: undefined, response: { status: 204 } });
    await expect(
      confirmPasswordReset({
        email: "testuser_030@example.com",
        securityAnswer: "A",
        newPassword: "NewTestPass456!",
      }),
    ).resolves.toBeUndefined();
  });

  it("429 で ApiError を投げる", async () => {
    mockPost.mockResolvedValue({
      error: { error: { code: "TOO_MANY_REQUESTS", message: "試行しすぎ" } },
      response: { status: 429 },
    });
    await expect(
      confirmPasswordReset({
        email: "testuser_030@example.com",
        securityAnswer: "A",
        newPassword: "NewTestPass456!",
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("updateMe", () => {
  it("成功するとデータを返す", async () => {
    mockPatch.mockResolvedValue({
      data: { id: "u1", email: "a@example.com", displayName: "新" },
      error: undefined,
      response: { status: 200 },
    });
    const result = await updateMe({ displayName: "新" });
    expect(result.displayName).toBe("新");
  });

  it("失敗時、error に details/code が無くても既定メッセージになる", async () => {
    mockPatch.mockResolvedValue({ data: undefined, error: undefined, response: { status: 500 } });
    await expect(updateMe({ displayName: "" })).rejects.toMatchObject({
      status: 500,
      message: "通信エラーが発生しました",
    });
  });
});
