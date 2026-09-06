/**
 * バックエンド API を叩くための型安全なクライアント。
 *
 * - `schema.ts` は backend の openapi.json から自動生成した型（`npm run gen:api`）。
 * - `openapi-fetch` はその型を使って、パスやレスポンスを型チェックしてくれる
 *   軽量な fetch ラッパー。
 * - ベース URL は `EXPO_PUBLIC_API_BASE_URL`（.env から。environment.md）。
 *   `EXPO_PUBLIC_` が付いた環境変数は Expo がビルド時に埋め込む。
 *   ここには「ホストまで」（例: http://localhost:8000）を入れる。パスの
 *   `/api/v1/...` や `/healthz` は schema.ts 側に含まれる。
 *
 * ここに認証まわりのミドルウェアを 2 つ登録している（Issue #36）:
 * 1. リクエストのたびに `Authorization: Bearer <アクセストークン>` を注入する。
 * 2. レスポンスが 401 なら、リフレッシュ（single-flight）→ 成功すれば元の
 *    リクエストを新しいトークンで自動的にやり直す。失敗（reuse 検知や
 *    token_version 不一致を含む）ならセッションを破棄し、以降は
 *    `useProtectedRoute`（認可ゲート）が isAuthenticated の変化を見て
 *    ログイン画面へ誘導する。
 *
 * 「トークン失効の検知・破棄」はこのファイル（データ層）の責務、
 * 「画面遷移」は useProtectedRoute の責務、と分けている
 * （features/auth/useProtectedRoute.ts 参照）。
 */
import createClient from "openapi-fetch";

import { RefreshCoordinator, type RefreshResult } from "./refreshCoordinator";
import type { paths } from "./schema";
import { secureStorage } from "../lib/secureStorage";
import { useSession } from "../store/session";

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export const api = createClient<paths>({
  baseUrl,
  // openapi-fetch はデフォルトだと `createClient` を呼んだ瞬間の
  // `globalThis.fetch` を固定で覚えてしまう。MSW（テストでのネットワーク
  // モック）は `globalThis.fetch` を後から上書きする仕組みのため、
  // 固定されたままだと差し替えが効かない。呼び出しのたびに
  // `globalThis.fetch` を読みに行く薄いラッパーにしておくことで、
  // いつ差し替えられても正しく反映されるようにする。
  fetch: (...args) => globalThis.fetch(...args),
});

// リフレッシュ自体のリクエスト（/auth/refresh）が 401 になった場合は
// リトライしない（無限ループを防ぐ）。パスの末尾だけで判定する
// （baseUrl が付いた絶対 URL でも相対 URL でも一致するように）。
const REFRESH_PATH = "/api/v1/auth/refresh";
// /auth/logout のボディには失効させたいリフレッシュトークンが入っている。
// 401 → refresh 成功後に元のリクエストをそのまま複製してリトライすると、
// ローテーション前の（もう無効な）トークンを送ってしまい、新しく発行された
// トークンがサーバー側に残り続けてしまう。ボディを新トークンで作り直す必要が
// あるため、パスで判定してリトライ処理を分ける。
const LOGOUT_PATH = "/api/v1/auth/logout";

async function callRefreshEndpoint(refreshToken: string): Promise<RefreshResult> {
  try {
    const { data, error } = await api.POST("/api/v1/auth/refresh", {
      body: { refreshToken },
    });
    if (error || !data) {
      return { ok: false };
    }

    // 永続化・セッションへの反映も、この関数（RefreshCoordinator が
    // single-flight で保護している範囲）の中で終わらせる。onResponse 側で
    // 後から行うと、この Promise が解決した時点で `inFlight` が解放されて
    // しまい、その解放～永続化完了までの間に別リクエストの 401 が新しい
    // リフレッシュを始めてしまう（サーバーからは「使用済みトークンの
    // 再提示」＝reuse に見え、チェーン全体が失効する）レースが起きる。
    try {
      const { rememberMe } = useSession.getState();
      if (rememberMe) {
        await secureStorage.setRefreshToken(data.refreshToken);
      }
      useSession.getState().setAccessTokenOnly(data.accessToken, data.refreshToken);
    } catch {
      // サーバー側は既にローテーション済みなのに、ローカルへの永続化が
      // 失敗した場合。中途半端に「認証済み」のまま残すと、次回以降すべての
      // リクエストが 401 を繰り返すだけになるため失敗として扱う
      // （呼び出し元 onResponse が clearSessionAndStorage() する）。
      return { ok: false };
    }

    return { ok: true, accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    // ネットワークエラー等で fetch 自体が reject した場合も失敗として扱う。
    // ここで投げっぱなしにすると、呼び出し元の onResponse が
    // clearSessionAndStorage() を素通りし、無効なトークンのまま
    // isAuthenticated=true が残ってしまう。
    return { ok: false };
  }
}

const refreshCoordinator = new RefreshCoordinator(callRefreshEndpoint);

async function clearSessionAndStorage(): Promise<void> {
  useSession.getState().clear();
  // メモリ上のセッションは既に破棄済み。ストレージ側の削除はベストエフォート
  // に留める（ここで例外を投げると、呼び出し元の onResponse がサーバーからの
  // 本来の 401 ではなく「ストレージ削除失敗」を返してしまう）。
  try {
    await secureStorage.deleteRefreshToken();
  } catch {
    // 無視する。
  }
  try {
    await secureStorage.deleteUser();
  } catch {
    // 無視する。
  }
}

// fetch に渡した Request はボディが「ストリーム」なので、送信済みのものを
// そのまま作り直すことはできない（一度しか読めない）。401 になったときに
// 同じボディでリトライできるよう、送信前の時点で複製（`.clone()`）を
// `id`（openapi-fetch がリクエストごとに振る一意な ID）をキーに退避しておく。
const pendingRequestClones = new Map<string, Request>();

api.use({
  onRequest({ request, id }) {
    const { accessToken } = useSession.getState();
    if (accessToken && !request.headers.has("Authorization")) {
      request.headers.set("Authorization", `Bearer ${accessToken}`);
    }
    pendingRequestClones.set(id, request.clone());
    return request;
  },

  async onResponse({ request, response, id }) {
    const requestClone = pendingRequestClones.get(id);
    pendingRequestClones.delete(id);

    if (response.status !== 401) return response;
    if (new URL(request.url).pathname.endsWith(REFRESH_PATH)) return response;

    const { refreshToken } = useSession.getState();
    if (!refreshToken || !requestClone) {
      await clearSessionAndStorage();
      return response;
    }

    const result = await refreshCoordinator.refresh(refreshToken);
    if (!result.ok) {
      // 永続化の失敗（callRefreshEndpoint 内）もここに含まれる。
      await clearSessionAndStorage();
      return response;
    }

    // 退避しておいた複製を、新しいアクセストークンを付けてやり直す。
    requestClone.headers.set("Authorization", `Bearer ${result.accessToken}`);
    const retryResponse = await (new URL(request.url).pathname.endsWith(LOGOUT_PATH)
      ? fetch(
          new Request(requestClone, {
            body: JSON.stringify({ refreshToken: result.refreshToken }),
          }),
        )
      : fetch(requestClone));

    if (retryResponse.status === 401) {
      // リフレッシュ自体は成功したのに、新しいアクセストークンでのリトライも
      // 401 になった場合（例: リフレッシュの直後にアカウントが無効化された、
      // token_version が変わった等）。ここでセッションを破棄しておかないと
      // isAuthenticated=true のまま残り、useProtectedRoute がログイン画面へ
      // 誘導できず、以降のリクエストのたびに無駄なリフレッシュを繰り返す。
      await clearSessionAndStorage();
    }
    return retryResponse;
  },

  onError({ id }) {
    // ネットワークエラー等で onResponse が呼ばれずに終わった場合の後始末。
    pendingRequestClones.delete(id);
  },
});
