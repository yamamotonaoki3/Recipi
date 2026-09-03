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
 */
import createClient from "openapi-fetch";

import type { paths } from "./schema";

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export const api = createClient<paths>({ baseUrl });
