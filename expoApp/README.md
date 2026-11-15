# expoApp（Recipi フロントエンド・TypeScript トラック）

React Native + Expo（必須トラック）。デスクトップ（Windows / macOS）は
Web ビルドを Tauri 2 で包む。要件定義書は
[`../docs/requirements/`](../docs/requirements/)、画面仕様は
[`../docs/requirements/screens/`](../docs/requirements/screens/)。

## コードの読み方（`src/` の主要ディレクトリ）

| 場所                     | 役割                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/`               | 画面。**Expo Router のファイルベースルーティング**（`app/` の構成 = 画面遷移）。`_layout.tsx` が全画面の外枠                   |
| `src/api/`               | `schema.ts` はOpenAPIから自動生成（`npm run gen:api`）。`client.ts` と `refreshCoordinator.ts` が型安全なfetchと認証更新を担う |
| `src/features/`          | 機能別のAPI呼び出し・TanStack Queryフック・編集フォーム・更新確認など                                                          |
| `src/screens/`           | ルートから利用する共通の画面実装                                                                                               |
| `src/store/`             | クライアント側の状態（**Zustand**）。認証やUIの状態を保持。サーバーデータは `src/features/` のTanStack Queryフックが扱う       |
| `src/lib/secureStorage/` | AndroidはSecureStore、TauriはStrongholdでトークンを保存。通常WebはHttpOnly Cookie認証を使う                                    |
| `src/providers/`         | アプリ全体を包むプロバイダ（QueryClient など）                                                                                 |
| `src/global.css`         | NativeWind（React Native 版 Tailwind）のベース。`className="..."` で Tailwind クラスが使える                                   |
| `src-tauri/`             | デスクトップシェル（Tauri 2 / Rust）。`dist/`（Web ビルド）を読み込む                                                          |

`src/app/` はルーティングと認証ゲートを担当し、画面・機能の実装を上記ディレクトリで共有する。

## セットアップ

前提: Node.js 24.x、（デスクトップを触るなら）Rust ＋ Windows は MSVC Build Tools。

```bash
cd expoApp
npm ci                          # package-lock.json どおりに入れる

cp .env.development.example .env.development
#   → EXPO_PUBLIC_API_BASE_URL をバックエンドのホストに合わせる
#     Web/デスクトップ                  = http://localhost:8000
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
npm test -- --coverage          # + カバレッジ（行 75% / 分岐 65% 下限）

npm run gen:api                 # openapi.json から src/api/schema.ts を再生成
npm run build:web               # dist/ に Web ビルド（Tauri の中身）
npm run tauri:build             # デスクトップの配布パッケージ（未署名）
```

## アイコン / ファビコンの差し替え

アプリアイコン・ファビコン・スプラッシュは、原本 1 枚から全プラットフォーム分を生成する。

```bash
# 1. 1024x1024 の正方形 PNG を原本として置く
#    → ../design/icons/app-icon.png
# 2. 生成する
npm run gen:icons
# 3. git diff で差分を確認してコミット
```

生成先は `assets/images/`（Expo: iOS / Android / Web）と `src-tauri/icons/`（デスクトップ）。
必要なファイル・セーフゾーン・背景色の扱いは
[`../design/icons/README.md`](../design/icons/README.md) を参照。

## 画像権限

`app.json` の `microphonePermission: false` は、アプリが静止画だけを扱い録音しないため、
`expo-image-picker` が不要なマイク権限（Android の録音権限や iOS のマイク説明文）を追加しないようにする設定です。

## テストの方針（[`../docs/requirements/testing.md`](../docs/requirements/testing.md)）

- **BB（仕様ベース）**: 画面 / hook が仕様どおり振る舞うか。
- **WB（実装ベース）**: 条件分岐・状態遷移を網羅（`jest.config.js` の `coverageThreshold`）。
- `jest.config.js` は2つのプロジェクトを実行する。`react-native` はjest-expoで画面・フックを検証し、APIクライアントを `jest.mock` で差し替える。`node` は `*.msw.test.ts` を対象にMSWで通信をモックし、認証更新やAPIクライアントの実際のfetch経路を検証する。

## バージョン

Expo SDK 58 / React Native 0.88 / Node 24。パッケージは `package-lock.json` で
固定（CI は `npm ci`）。`.npmrc` で `legacy-peer-deps=true`（RN/Expo エコシステムの
peer 依存の食い違いを許容するための実務的な設定）。
