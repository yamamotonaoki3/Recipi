/**
 * リフレッシュトークンの single-flight（同時実行の一本化）を担当する。
 *
 * features/auth.md の要求:
 * 「クライアントはリフレッシュを single-flight で行い、同時に複数の
 * リクエストで更新が必要になっても POST /auth/refresh は1本だけ実行し、
 * 他のリクエストはその結果を待つ」
 *
 * これが無いと、複数の 401 が同時に発生したときに `/auth/refresh` が
 * 並行して何本も呼ばれてしまう。バックエンドはリフレッシュトークンを
 * 使い捨て（ローテーション）で運用しており、2 本目以降の呼び出しは
 * 「既に使用済みのトークンの再提示（reuse）」とみなされてチェーン全体が
 * 失効し、意図せずログアウトになってしまう。
 *
 * React（hook）や openapi-fetch の型に依存しない、素の TypeScript クラスに
 * している。単体テストしやすく、`client.ts` から呼び出すだけで使える。
 */
export type RefreshResult = { ok: true; accessToken: string; refreshToken: string } | { ok: false };

export type RefreshFn = (refreshToken: string) => Promise<RefreshResult>;

export class RefreshCoordinator {
  private inFlight: Promise<RefreshResult> | null = null;

  constructor(private readonly refreshFn: RefreshFn) {}

  /**
   * リフレッシュを実行する。既に実行中なら、新しく実行はせず
   * 進行中の Promise に相乗り（同じ結果を待つ）する。
   */
  refresh(currentRefreshToken: string): Promise<RefreshResult> {
    if (this.inFlight) return this.inFlight;

    const promise = this.refreshFn(currentRefreshToken).finally(() => {
      // このリフレッシュが「今進行中のもの」でなくなったので解放する。
      if (this.inFlight === promise) {
        this.inFlight = null;
      }
    });
    this.inFlight = promise;
    return promise;
  }
}
