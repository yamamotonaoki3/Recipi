/**
 * 秘密の質問の変更 API の結合テスト（Node + MSW。Issue #242）。
 *
 * **画面テストでは API 関数をモックするので、認証ミドルウェア（`src/api/client.ts`）を
 * 通らない。** 「現在のパスワードを間違えてもログアウトされない」ことは、実際の API 関数と
 * 実際のクライアントに 403 を返して確かめる必要がある（画面テストで `useSession` が
 * 変わらないことを見ても、ミドルウェアが壊れたときに気づけない）。
 *
 * 403 `REAUTH_FAILED` にした理由: クライアントは 401 を「トークン切れ」と解釈して
 * リフレッシュ → 再送 → それでも 401 ならセッション破棄、と進む。401 だとパスワードを
 * 打ち間違えただけでログアウトさせられる（backend の app/errors.py `reauth_failed`）。
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { useSession } from "../../store/session";

jest.mock("../../lib/secureStorage", () => ({
  secureStorage: {
    getRefreshToken: jest.fn().mockResolvedValue(null),
    setRefreshToken: jest.fn().mockResolvedValue(undefined),
    deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../lib/authPlatform", () => ({
  usesCookieAuth: jest.fn(() => false),
  isTauriTokenClient: jest.fn(() => false),
}));

// 整形で折り返されると抑止コメントが外れるので、型を先に取り出して 1 行に収める。
type SecureStorageModule = typeof import("../../lib/secureStorage");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { secureStorage } = require("../../lib/secureStorage") as SecureStorageModule;
// client.ts は読み込み時にミドルウェアを登録するので、jest.mock より後に読み込む。
// eslint-disable-next-line import/first
import { ApiError } from "../auth/api";
// eslint-disable-next-line import/first
import { changeEmail, changeSecurityQuestion } from "./api";

const BASE_URL = "http://localhost:8000";
const URL_CHANGE = `${BASE_URL}/api/v1/users/me/security-question`;
const URL_EMAIL = `${BASE_URL}/api/v1/users/me/email`;
const URL_REFRESH = `${BASE_URL}/api/v1/auth/refresh`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  useSession.getState().clear();
  jest.clearAllMocks();
});
afterAll(() => server.close());

const BODY = {
  currentPassword: "WrongPass1!",
  securityQuestion: "初めて飼ったペットの名前は？",
  securityAnswer: "ポチ",
};

function signIn() {
  useSession.getState().setAuth({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    rememberMe: true,
  });
}

it("現在のパスワード違い（403 REAUTH_FAILED）では、リフレッシュもログアウトもしない", async () => {
  signIn();
  let putCalls = 0;
  let refreshCalls = 0;
  server.use(
    http.put(URL_CHANGE, () => {
      putCalls += 1;
      return HttpResponse.json(
        {
          error: {
            code: "REAUTH_FAILED",
            message: "現在のパスワードが正しくありません",
            details: null,
          },
        },
        { status: 403 },
      );
    }),
    http.post(URL_REFRESH, () => {
      refreshCalls += 1;
      return HttpResponse.json({ accessToken: "should-not-happen", refreshToken: null });
    }),
  );

  const error = await changeSecurityQuestion(BODY).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 403, code: "REAUTH_FAILED" });
  // 同じ要求を 1 回だけ送り、トークン切れ扱いのリフレッシュ・再送はしない。
  expect(putCalls).toBe(1);
  expect(refreshCalls).toBe(0);
  // セッションはそのまま（ログアウトしていない）。
  expect(useSession.getState().accessToken).toBe("access-1");
  expect(useSession.getState().refreshToken).toBe("refresh-1");
  expect(secureStorage.deleteRefreshToken).not.toHaveBeenCalled();
});

it("成功（204）なら例外を投げない", async () => {
  signIn();
  let received: unknown = null;
  server.use(
    http.put(URL_CHANGE, async ({ request }) => {
      received = await request.json();
      return new HttpResponse(null, { status: 204 });
    }),
  );

  await expect(changeSecurityQuestion(BODY)).resolves.toBeUndefined();
  expect(received).toEqual(BODY);
});

it("429 は ApiError として返す（ログアウトしない）", async () => {
  signIn();
  server.use(
    http.put(URL_CHANGE, () =>
      HttpResponse.json(
        { error: { code: "TOO_MANY_REQUESTS", message: "多すぎます", details: null } },
        { status: 429 },
      ),
    ),
  );

  await expect(changeSecurityQuestion(BODY)).rejects.toMatchObject({ status: 429 });
  expect(useSession.getState().accessToken).toBe("access-1");
});

it("メール変更は rememberMe を含めて送信し、トークン対を返す", async () => {
  signIn();
  let received: unknown;
  server.use(
    http.put(URL_EMAIL, async ({ request }) => {
      received = await request.json();
      return HttpResponse.json({
        user: { id: "u1", displayName: "太郎" },
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });
    }),
  );
  await expect(
    changeEmail({ currentPassword: "TestPass123!", email: "new@example.com", rememberMe: true }),
  ).resolves.toMatchObject({ accessToken: "new-access" });
  expect(received).toEqual({
    currentPassword: "TestPass123!",
    email: "new@example.com",
    rememberMe: true,
  });
});

it("メール重複の409は ApiError として返し、ログアウトしない", async () => {
  signIn();
  server.use(
    http.put(URL_EMAIL, () =>
      HttpResponse.json(
        { error: { code: "EMAIL_TAKEN", message: "既に使われています", details: null } },
        { status: 409 },
      ),
    ),
  );
  await expect(
    changeEmail({ currentPassword: "TestPass123!", email: "taken@example.com", rememberMe: true }),
  ).rejects.toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
  expect(useSession.getState().isAuthenticated).toBe(true);
});

it("メール変更の403 REAUTH_FAILEDでもリフレッシュ・ログアウトしない", async () => {
  signIn();
  let refreshCalls = 0;
  server.use(
    http.put(URL_EMAIL, () =>
      HttpResponse.json(
        {
          error: {
            code: "REAUTH_FAILED",
            message: "現在のパスワードが正しくありません",
            details: null,
          },
        },
        { status: 403 },
      ),
    ),
    http.post(URL_REFRESH, () => {
      refreshCalls += 1;
      return HttpResponse.json({ accessToken: "unexpected", refreshToken: "unexpected" });
    }),
  );
  await expect(
    changeEmail({ currentPassword: "WrongPass1!", email: "new@example.com", rememberMe: true }),
  ).rejects.toMatchObject({ status: 403, code: "REAUTH_FAILED" });
  expect(refreshCalls).toBe(0);
  expect(useSession.getState().isAuthenticated).toBe(true);
});
