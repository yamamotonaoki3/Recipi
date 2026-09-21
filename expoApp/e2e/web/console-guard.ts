/**
 * Web E2E のコンソール監視（Issue #247）。
 *
 * **監視対象ページで発生した error レベルのコンソール出力と、未捕捉例外（pageerror）を
 * 検出して、そのテストを失敗させる。** ネットワークの失敗や `console.warn` は対象外
 * （警告まで落とすとゲートが形骸化する。ネットワーク監視が要るなら別途足す）。
 *
 * ## 使い方
 *
 * spec は `@playwright/test` ではなく **`./console-guard` の `test` / `expect`** を import する。
 * 組み込みの `page` を差し替えてあるので、`page` を使うだけで監視される。
 *
 * - `browser.newContext().newPage()` で自分で作ったページは**自動では監視されない**。
 *   `consoleGuard.watch(page)` を**最初の `goto` の前に**呼ぶ（`password-reset.spec.ts` の端末 B）。
 * - `request` だけを使う API 層の spec では `page` を要求しないので、ブラウザは起動しない。
 *
 * ## 限界（遅れて届くエラーは逃す）
 *
 * テストが終わってページが閉じた後に届くエラーは拾えない。例えば存在しないホストへの
 * 画像読み込みは、名前解決の失敗がコンソールに届くまで**約 2.7 秒**かかる（Issue #268 の
 * 調査で実測）。1〜2 秒で終わるテストでは届く前にページが閉じ、**失敗が素通りする**。
 * 実際 `recipe-crud.spec.ts` は画像付きで保存しているのに、このエラーを一度も出していなかった。
 * 「ゲートを通った＝エラーが無い」ではなく、「テスト中に届いたエラーは無い」という意味。
 *
 * ## 許可の考え方
 *
 * 許可は 3 種類に分け、**原因の分からないエラーはどれにも入れない**（直すか、ゲートに落とさせる）。
 *
 * 1. **テストの中だけの許可**（`consoleGuard.allow(...)`）: そのテストが意図して通す異常系
 *    （誤ったパスワードの 401 など）。URL とメッセージの両方で絞り、理由を書く。
 *    Chromium は 4xx の応答を必ず「Failed to load resource」として出すので、これを全体で
 *    許すと無関係な不具合まで隠れる。
 * 2. **仕様どおりの共通許可**（`BUILTIN_ALLOWANCES`）: どのテストでも必ず起きる、設計上の挙動。
 *    URL を 1 本に限定して、他を巻き込まない。
 * 3. **追跡 Issue 付きの一時許可**（`KNOWN_ISSUES`）: 本物の不具合だが、この Issue の範囲では
 *    直さないもの。**Issue 番号と解除条件を必ず書く**。直したら許可を消す。
 *    ここに無言で足すのは禁止（「とりあえず通す」ためのゴミ箱にしない）。
 */
import { test as base, expect, type ConsoleMessage, type Page } from "@playwright/test";

export { expect };

type Kind = "console" | "pageerror";

export type CapturedProblem = { kind: Kind; text: string; url: string };

export type Allowance = {
  kind: Kind;
  /** メッセージに対する正規表現。空の正規表現は受け付けない。 */
  message: RegExp;
  /** 発生元 URL に対する正規表現（console のときに照合する）。 */
  url?: RegExp;
  /** なぜ無害なのか。空文字は受け付けない。 */
  reason: string;
};

/** 追跡 Issue 付きの一時許可。直したら消す。 */
export type KnownIssue = Allowance & {
  /** 不具合を追跡する Issue 番号。 */
  issue: number;
  /** この許可を消してよくなる条件。 */
  removeWhen: string;
};

/**
 * 仕様どおりの共通許可。
 *
 * - 起動時のセッション復元: Web は refresh token を HttpOnly Cookie で持ち、開いた直後に
 *   `/auth/refresh` でセッションを復元しようとする（features/auth.md）。未ログインなら
 *   401 が返るのが正しい挙動で、ブラウザはこれを必ずコンソールに出す（アプリ側では止められない）。
 *   URL を `/auth/refresh` だけに限定し、他の 401 は隠さない。
 */
export const BUILTIN_ALLOWANCES: readonly Allowance[] = [
  {
    kind: "console",
    message: /status of 401 \(Unauthorized\)/,
    url: /\/api\/v1\/auth\/refresh$/,
    reason: "未ログインで開いたときのセッション復元の失敗（仕様どおり。features/auth.md）",
  },
];

/** 追跡 Issue 付きの一時許可（本物の不具合）。直したら該当の行を消すこと。 */
export const KNOWN_ISSUES: readonly KnownIssue[] = [];

export class ConsoleGuard {
  private readonly problems: CapturedProblem[] = [];
  private readonly allowances: Allowance[];

  /** `initial` はフィクスチャが共通許可と一時許可を渡す。単体で使うときは空。 */
  constructor(initial: readonly Allowance[] = []) {
    this.allowances = [...initial];
  }

  private readonly detachers: (() => void)[] = [];

  /** ページを監視対象にする。最初の `goto` より前に呼ぶこと。 */
  watch(page: Page): void {
    const onConsole = (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      this.problems.push({ kind: "console", text: msg.text(), url: msg.location().url ?? "" });
    };
    const onPageError = (error: Error) => {
      this.problems.push({ kind: "pageerror", text: error.message, url: page.url() });
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    this.detachers.push(() => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    });
  }

  /** このテストの中だけで、想定内のエラーを許可する。 */
  allow(allowance: Allowance): void {
    if (!allowance.reason.trim()) throw new Error("consoleGuard.allow には理由が必要です");
    if (allowance.message.source === "(?:)") {
      throw new Error("consoleGuard.allow に空のパターンは使えません");
    }
    this.allowances.push(allowance);
  }

  /** 許可されていない問題の一覧。 */
  unexpected(): CapturedProblem[] {
    return this.problems.filter(
      (p) =>
        !this.allowances.some(
          (a) =>
            a.kind === p.kind &&
            a.message.test(p.text) &&
            (a.url === undefined || a.url.test(p.url)),
        ),
    );
  }

  /** 許可されていない問題があれば、内容を並べた例外を投げる。 */
  assertClean(): void {
    const unexpected = this.unexpected();
    if (unexpected.length === 0) return;
    const lines = unexpected.map((p) => `  - [${p.kind}] ${p.text}${p.url ? ` (${p.url})` : ""}`);
    throw new Error(
      `コンソール監視（Issue #247）: 許可されていないエラーが ${unexpected.length} 件あります。\n` +
        `${lines.join("\n")}\n` +
        "原因を直すか、無害だと確認できた場合だけ consoleGuard.allow で理由付きで許可してください。",
    );
  }

  dispose(): void {
    for (const detach of this.detachers.splice(0)) detach();
  }
}

// フィクスチャの第 2 引数は Playwright では慣例で `use` と呼ぶが、React の `use` フックと
// 誤認されて react-hooks/rules-of-hooks が反応するため `provide` と名付ける（位置で渡される）。
export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  // Playwright は第 1 引数の分割代入から依存フィクスチャを読み取るため、依存が無くても `{}` が要る。
  // eslint-disable-next-line no-empty-pattern
  consoleGuard: async ({}, provide) => {
    const guard = new ConsoleGuard([...BUILTIN_ALLOWANCES, ...KNOWN_ISSUES]);
    await provide(guard);
    guard.dispose();
    guard.assertClean();
  },
  // 組み込みの page を差し替える。page を要求しないテスト（API 層）では評価されない。
  page: async ({ page, consoleGuard }, provide) => {
    consoleGuard.watch(page);
    await provide(page);
  },
});
