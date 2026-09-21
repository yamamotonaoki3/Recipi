/**
 * Web（Cookie 認証）で「ログインを保持」の選択を覚える（Issue #275）。
 *
 * Web のリフレッシュトークンは HttpOnly Cookie にあり、JS からは中身も有効期限も見えない。
 * そのため再読み込みでセッションを復元するとき、利用者が保持を選んでいたかどうかが分からず、
 * 以前は常に `true` にしていた。すると保持 OFF（ブラウザを閉じると消えるセッション Cookie）
 * の人が、メールアドレス変更などで `rememberMe: true` を送り、意図せず長期 Cookie に切り替わる。
 *
 * そこで選択そのものを `localStorage` に控える（トークンではないので秘密情報ではない）。
 * - 控えが無い / 読めないときは **`false`（保持しない）** とみなす。間違えても短い方に倒れるだけで、
 *   長い方へ勝手に切り替わることは無い。
 * - ログアウトで消さなくてよい: Cookie が無ければ復元自体が起きず、次のログインで上書きされる。
 * - ネイティブ / Tauri は保存時に決まる（保持 ON のときだけトークンを保存する）ので対象外。
 */
import { usesCookieAuth } from "@/lib/authPlatform";

const KEY = "recipi.rememberMe";

/** ログイン・登録・再開・メールアドレス変更で、その時点の選択を控える。 */
export function saveRememberChoice(rememberMe: boolean): void {
  if (!usesCookieAuth()) return;
  try {
    window.localStorage.setItem(KEY, rememberMe ? "1" : "0");
  } catch {
    // 私的ブラウズ等で書けなくても、認証自体は続ける（次回の復元が「保持しない」扱いになるだけ）。
  }
}

/** 復元時に使う。控えが無ければ `false`。 */
export function readRememberChoice(): boolean {
  if (!usesCookieAuth()) return true;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
