/**
 * client.ts の結合テスト（Node 環境 + MSW）。
 *
 * `jest.mock("./client")` で client.ts 自体を差し替えてしまうと、
 * テストしたい対象（認証ヘッダーの注入・401 検知・single-flight リフレッシュ
 * ・リトライ）そのものが消えてしまうため、ここでは MSW（Mock Service Worker）
 * で実際の fetch 通信をネットワークレベルからモックする。
 *
 * jest.config.js の "node" project（`*.msw.test.ts` にマッチ）で実行される。
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { useSession } from "../store/session";

// secureStorage は Tauri/expo-secure-store の実体に依存しないよう、
// このテストでは常にモックする（getRefreshToken/setRefreshToken/
// deleteRefreshToken の呼び出し回数・引数だけを検証する）。
jest.mock("../lib/secureStorage", () => ({
  secureStorage: {
    getRefreshToken: jest.fn().mockResolvedValue(null),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { secureStorage } = require("../lib/secureStorage") as typeof import("../lib/secureStorage");
// client.ts はモジュール読み込み時に `api.use(...)` でミドルウェアを
// 登録するので、上の jest.mock より後に import する。
// eslint-disable-next-line import/first
import { api } from "./client";

const BASE_URL = "http://localhost:8000";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  useSession.getState().clear();
  jest.clearAllMocks();
});
afterAll(() => server.close());

describe("client.ts の認証ミドルウェア", () => {
  it("アクセストークンがあれば Authorization ヘッダーを自動で付ける", async () => {
    useSession.getState().setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      rememberMe: false,
    });

    let receivedAuth: string | null = null;
    server.use(
      http.patch(`${BASE_URL}/api/v1/users/me`, ({ request }) => {
        receivedAuth = request.headers.get("Authorization");
        return HttpResponse.json({ id: "u1", email: "a@example.com", displayName: "太郎" });
      }),
    );

    const { error } = await api.PATCH("/api/v1/users/me", {
      body: { displayName: "太郎" },
    });

    expect(error).toBeUndefined();
    expect(receivedAuth).toBe("Bearer access-1");
  });

  it("401 を受けたらリフレッシュして、新しいトークンで自動的にリトライする", async () => {
    useSession.getState().setAuth({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      rememberMe: true,
    });

    let meCallCount = 0;
    server.use(
      http.patch(`${BASE_URL}/api/v1/users/me`, ({ request }) => {
        meCallCount += 1;
        const auth = request.headers.get("Authorization");
        if (auth === "Bearer new-access") {
          return HttpResponse.json({ id: "u1", email: "a@example.com", displayName: "太郎" });
        }
        return HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "認証に失敗しました", details: null } },
          { status: 401 },
        );
      }),
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ accessToken: "new-access", refreshToken: "new-refresh" }),
      ),
    );

    const { data, error } = await api.PATCH("/api/v1/users/me", {
      body: { displayName: "太郎" },
    });

    expect(error).toBeUndefined();
    expect(data).toEqual({ id: "u1", email: "a@example.com", displayName: "太郎" });
    expect(meCallCount).toBe(2); // 1回目は401、2回目（リトライ）で成功
    expect(useSession.getState().accessToken).toBe("new-access");
    expect(useSession.getState().refreshToken).toBe("new-refresh");
    expect(secureStorage.setRefreshToken).toHaveBeenCalledWith("new-refresh");
  });

  it("リフレッシュ自体が失敗したらセッションを破棄する（reuse 検知等）", async () => {
    useSession.getState().setAuth({
      accessToken: "expired-access",
      refreshToken: "revoked-refresh",
      rememberMe: true,
    });

    server.use(
      http.patch(`${BASE_URL}/api/v1/users/me`, () =>
        HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "認証に失敗しました", details: null } },
          { status: 401 },
        ),
      ),
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () =>
        HttpResponse.json(
          {
            error: {
              code: "UNAUTHORIZED",
              message: "リフレッシュトークンの再利用を検知しました",
              details: null,
            },
          },
          { status: 401 },
        ),
      ),
    );

    const { error } = await api.PATCH("/api/v1/users/me", {
      body: { displayName: "太郎" },
    });

    expect(error).toBeDefined();
    expect(useSession.getState().isAuthenticated).toBe(false);
    expect(useSession.getState().accessToken).toBeNull();
    expect(secureStorage.deleteRefreshToken).toHaveBeenCalled();
  });

  it("リフレッシュ成功後のリトライがそれでも401なら、セッションを破棄する", async () => {
    useSession.getState().setAuth({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      rememberMe: false,
    });

    server.use(
      // リフレッシュ後の新しいアクセストークンでも 401（token_version 不一致等）。
      http.patch(`${BASE_URL}/api/v1/users/me`, () =>
        HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "認証に失敗しました", details: null } },
          { status: 401 },
        ),
      ),
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ accessToken: "new-access", refreshToken: "new-refresh" }),
      ),
    );

    const { error } = await api.PATCH("/api/v1/users/me", {
      body: { displayName: "太郎" },
    });

    expect(error).toBeDefined();
    expect(useSession.getState().isAuthenticated).toBe(false);
  });

  it("同時に複数リクエストが401になっても、リフレッシュは1回だけ実行される", async () => {
    useSession.getState().setAuth({
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      rememberMe: false,
    });

    let refreshCallCount = 0;
    server.use(
      http.patch(`${BASE_URL}/api/v1/users/me`, ({ request }) => {
        const auth = request.headers.get("Authorization");
        if (auth === "Bearer new-access") {
          return HttpResponse.json({ id: "u1", email: "a@example.com", displayName: "太郎" });
        }
        return HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "認証に失敗しました", details: null } },
          { status: 401 },
        );
      }),
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () => {
        refreshCallCount += 1;
        return HttpResponse.json({ accessToken: "new-access", refreshToken: "new-refresh" });
      }),
    );

    const results = await Promise.all([
      api.PATCH("/api/v1/users/me", { body: { displayName: "A" } }),
      api.PATCH("/api/v1/users/me", { body: { displayName: "B" } }),
    ]);

    expect(refreshCallCount).toBe(1);
    for (const { error } of results) {
      expect(error).toBeUndefined();
    }
  });

  it("logout が401でリトライされるとき、ローテーション後の新しいリフレッシュトークンで再送する", async () => {
    useSession.getState().setAuth({
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      rememberMe: false,
    });

    let receivedLogoutBody: unknown = null;
    server.use(
      http.post(`${BASE_URL}/api/v1/auth/logout`, async ({ request }) => {
        const auth = request.headers.get("Authorization");
        if (auth !== "Bearer new-access") {
          return HttpResponse.json(
            { error: { code: "UNAUTHORIZED", message: "認証に失敗しました", details: null } },
            { status: 401 },
          );
        }
        receivedLogoutBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ accessToken: "new-access", refreshToken: "new-refresh" }),
      ),
    );

    const { error } = await api.POST("/api/v1/auth/logout", {
      body: { refreshToken: "old-refresh" },
    });

    expect(error).toBeUndefined();
    // 401 → refresh 成功後のリトライで、ボディが古いトークンのままだと
    // サーバー側は「もう無効なトークン」を渡されたことになり、実際には
    // ローテーション後の新しいリフレッシュトークンを失効できない。
    expect(receivedLogoutBody).toEqual({ refreshToken: "new-refresh" });
  });
});
