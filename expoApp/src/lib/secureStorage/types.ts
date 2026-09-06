/**
 * リフレッシュトークンの永続化インターフェース。
 *
 * 実装は「iOS/Android（expo-secure-store）」「Tauri デスクトップ
 * （tauri-plugin-stronghold）」の2通りがあり、`index.ts` が
 * 実行環境を見てどちらを使うか選ぶ（プラットフォームごとに
 * ファイルを分けるだけで済ませず、ランタイム判定にしているのは、
 * Web ビルド自体は Tauri でもブラウザ単体でも同じものが動くため。
 * Metro の `.native.ts` 拡張子解決はビルド時に固定されてしまい、
 * 同じ Web バンドルを Tauri と非 Tauri の両方で使う今回の構成には
 * 向かない）。
 */
export interface SecureStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  deleteRefreshToken(): Promise<void>;
  // `/auth/refresh` はトークンのみ返しユーザー情報を含まない
  // （ローテーション専用のエンドポイントを最小限にするため）。
  // 「ログインを保持」での自動復元時に表示名などをすぐ使えるよう、
  // ユーザー情報もリフレッシュトークンと一緒にここへ保存しておく。
  getUser(): Promise<string | null>;
  setUser(userJson: string): Promise<void>;
  deleteUser(): Promise<void>;
}
