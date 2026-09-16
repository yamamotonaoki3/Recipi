// 性能テスト（k6）の共通設定（Issue #145）。
//
// 値はすべて `k6 run -e 名前=値` で上書きできる（__ENV から読む）。
// パスワードの既定値は seed_perf.py の PERF_PASSWORD と同じ「テスト専用の固定値」で、
// 実在するアカウントの認証情報ではない（グローバル CLAUDE.md のテストデータ規約）。

export const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
export const API = `${BASE_URL}/api/v1`;
export const PASSWORD = __ENV.PERF_PASSWORD || "TestPass123!";

// seed_perf.py で入れたユーザー数（perfuser_001〜）。VU はこの中から自分のユーザーを選ぶ。
export const USER_COUNT = Number(__ENV.PERF_USERS || 200);

// 1 回の閲覧シナリオの後に休む秒数（人が画面を読む時間の代わり）。
export const THINK_TIME = Number(__ENV.THINK_TIME || 1);

// seed_perf.py と同じ語彙。検索語はここの材料名から選ぶので、必ずヒットする。
// open() は init コンテキスト（ファイルの一番外側）でしか呼べない。
export const vocabulary = JSON.parse(open(import.meta.resolve("../../data/vocabulary.json")));
