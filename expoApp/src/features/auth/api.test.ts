/**
 * features/auth/api.ts の単体テスト。
 * `@/api/client` を jest.mock で差し替え、成功/エラー分岐を確認する。
 */
import { api } from "@/api/client";
import {
  ApiError,
  confirmPasswordReset,
  getCurrentUser,
  login,
  logout,
  reactivate,
  requestPasswordReset,
  retryAfterMsFromResponse,
  signup,
} from "./api";

jest.mock("@/api/client", () => ({ api: { POST: jest.fn(), PATCH: jest.fn(), GET: jest.fn() } }));

const mockPost = api.POST as jest.Mock;
const mockPatch = api.PATCH as jest.Mock;
const mockGet = api.GET as jest.Mock;

beforeEach(() => {
  mockPost.mockReset();
  mockPatch.mockReset();
  mockGet.mockReset();
});

describe("retryAfterMsFromResponse", () => {
  it("秒数形式だけをミリ秒へ変換し、未指定・不正値は無視する", () => {
    expect(retryAfterMsFromResponse({ headers: new Headers({ "Retry-After": "5" }) })).toBe(5_000);
    expect(retryAfterMsFromResponse({ headers: new Headers() })).toBeUndefined();
    expect(
      retryAfterMsFromResponse({ headers: new Headers({ "Retry-After": "soon" }) }),
    ).toBeUndefined();
  });
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

describe("reactivate", () => {
  it("成功すると再開後の認証情報を返す", async () => {
    mockPost.mockResolvedValue({
      data: { user: { id: "u1", displayName: "太郎" }, accessToken: "a", refreshToken: "r" },
      error: undefined,
      response: { status: 200 },
    });
    await expect(
      reactivate({ email: "testuser_030@example.com", password: "TestPass123!", rememberMe: true }),
    ).resolves.toMatchObject({ accessToken: "a" });
    expect(mockPost).toHaveBeenCalledWith("/api/v1/auth/reactivate", {
      body: { email: "testuser_030@example.com", password: "TestPass123!", rememberMe: true },
    });
  });
});

describe("getCurrentUser", () => {
  it("アクセストークン付きで現在ユーザーを取得する", async () => {
    mockGet.mockResolvedValue({
      data: { id: "u1", displayName: "太郎", avatarUrl: null },
      error: undefined,
      response: { status: 200 },
    });

    await expect(getCurrentUser("access-token")).resolves.toMatchObject({ id: "u1" });
    expect(mockGet).toHaveBeenCalledWith("/api/v1/auth/me", {
      headers: { Authorization: "Bearer access-token" },
    });
  });

  it("401ではApiErrorを投げる", async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: "UNAUTHORIZED", message: "認証に失敗しました" } },
      response: { status: 401 },
    });

    await expect(getCurrentUser("invalid-token")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("503 の Retry-After を再試行待機時間として ApiError に渡す", async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: "SERVICE_UNAVAILABLE", message: "混み合っています" } },
      response: { status: 503, headers: new Headers({ "Retry-After": "5" }) },
    });

    await expect(getCurrentUser("access-token")).rejects.toMatchObject({
      status: 503,
      retryAfterMs: 5_000,
    });
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
