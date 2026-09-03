# expoApp（Recipi フロントエンド・TypeScript トラック）

React Native + Expo（必須トラック）。デスクトップ（Windows / macOS）は
Web ビルドを Tauri 2 で包む。要件定義書は
[`../docs/requirements/`](../docs/requirements/)、画面仕様は
[`../docs/requirements/screens/`](../docs/requirements/screens/)。

## コードの読み方（`src/` の主要ディレクトリ）

| 場所             | 役割                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`       | 画面。**Expo Router のファイルベースルーティング**（`app/` の構成 = 画面遷移）。`_layout.tsx` が全画面の外枠                                                    |
| `src/api/`       | バックエンド API。`schema.ts` は `openapi.json` からの自動生成（`npm run gen:api`）、`client.ts` が型安全な fetch、機能ごとに `useXxx` フック（TanStack Query） |
| `src/store/`     | クライアント側の状態（**Zustand**）。認証トークンや UI トグルなど「サーバーから取らないもの」だけ。サーバーデータは `src/api/` の TanStack Query が持つ         |
| `src/providers/` | アプリ全体を包むプロバイダ（QueryClient など）                                                                                                                  |
| `src/global.css` | NativeWind（React Native 版 Tailwind）のベース。`className="..."` で Tailwind クラスが使える                                                                    |
| `src-tauri/`     | デスクトップシェル（Tauri 2 / Rust）。`dist/`（Web ビルド）を読み込む                                                                                           |

Phase 1 以降で `src/features/`（機能別のコンポーネント）などを足していく。

## セットアップ

前提: Node.js 24.x、（デスクトップを触るなら）Rust ＋ Windows は MSVC Build Tools。

```bash
cd expoApp
npm ci                          # package-lock.json どおりに入れる

cp .env.development.example .env.development
#   → EXPO_PUBLIC_API_BASE_URL をバックエンドのホストに合わせる
#     Web/デスクトップ/iOS シミュレータ = http://localhost:8000
#     Android エミュレータ              = http://10.0.2.2:8000

npm run web                     # ブラウザで開発（デスクトップの土台）
npm run tauri:dev               # デスクトップアプリとして起動
npm run android                 # Android エミュレータ / 実機
```

> バックエンドは別ターミナルで起動しておく（[`../backend/README.md`](../backend/README.md)）。

## よく使うコマンド（CI と同じ内容）

```bash
npm run lint                    # ESLint
npm run format                  # Prettier --check（整形は `npx prettier --write .`）
npm run typecheck               # tsc --noEmit
npm test                        # jest（単体・結合）
npm test -- --coverage          # + カバレッジ（行 60% / 分岐 50% 下限）

npm run gen:api                 # openapi.json から src/api/schema.ts を再生成
npm run build:web               # dist/ に Web ビルド（Tauri の中身）
npm run tauri:build             # デスクトップの配布パッケージ（未署名）
```

## テストの方針（[`../docs/requirements/testing.md`](../docs/requirements/testing.md)）

- **BB（仕様ベース）**: 画面 / hook が仕様どおり振る舞うか。
- **WB（実装ベース）**: 条件分岐・状態遷移を網羅（`jest.config.js` の `coverageThreshold`）。
- Phase 0 は API クライアント（`src/api/client`）を `jest.mock` で差し替える方式。
  MSW（ネットワークモック）は jest-expo の react-native 実行環境と相性が悪いため、
  本格導入は Phase 1 で node 環境のテストとして整える。

## バージョン

Expo SDK 57 / React Native 0.86 / Node 24。パッケージは `package-lock.json` で
固定（CI は `npm ci`）。`.npmrc` で `legacy-peer-deps=true`（RN/Expo エコシステムの
peer 依存の食い違いを許容するための実務的な設定）。
