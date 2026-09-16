#!/usr/bin/env bash
# メトリクスフィルタのパターンを、実際のログのサンプル行で検証する（Issue #172）。
#
# なぜ必要か:
#   terraform validate や plan は「パターンの書き方が間違っていても」成功する。
#   パターンが実際のログと合っていないと、アラームは永久に鳴らない。
#
# 使うもの:
#   aws logs test-metric-filter … **読み取りだけの API**。ログもリソースも作らず、
#   課金もない。パターンとサンプル行を渡すと「一致した行」を返してくれる。
#
# 使い方:
#   bash infra/scripts/test-metric-filters.sh
# 前提: AWS CLI の認証（読み取りのみで可）。

set -euo pipefail

failures=0

# 一致するべき行・一致してはいけない行を渡して、結果の件数を確かめる。
#   $1 名前 / $2 パターン / $3 期待する一致数 / $4 以降 サンプル行
check() {
  local name="$1" pattern="$2" expected="$3"
  shift 3
  local matched
  matched=$(aws logs test-metric-filter \
    --filter-pattern "${pattern}" \
    --log-event-messages "$@" \
    --query 'length(matches)' --output text)

  if [ "${matched}" = "${expected}" ]; then
    printf 'OK   %-22s 一致 %s 件（期待どおり）\n' "${name}" "${matched}"
  else
    printf 'NG   %-22s 一致 %s 件（期待は %s 件）\n' "${name}" "${matched}" "${expected}"
    failures=$((failures + 1))
  fi
}

# --- サンプル行（backend/tests/test_logging.py・test_audit_log.py が検査している形）---
# アクセスログ: status は「数値」。監査ログ: action / outcome / reason は文字列。
ACCESS_500='{"time":"2026-09-16T00:00:00.000Z","level":"ERROR","logger":"app.access","log_type":"access","method":"GET","path":"/api/v1/recipes","status":500,"duration_ms":12.3,"request_id":"r1","user_id":"-","service":"recipi-api","env":"production"}'
ACCESS_200='{"time":"2026-09-16T00:00:00.000Z","level":"INFO","logger":"app.access","log_type":"access","method":"GET","path":"/api/v1/recipes","status":200,"duration_ms":12.3,"request_id":"r2","user_id":"-","service":"recipi-api","env":"production"}'
ACCESS_404='{"time":"2026-09-16T00:00:00.000Z","level":"WARNING","logger":"app.access","log_type":"access","method":"GET","path":"/nope","status":404,"duration_ms":1.0,"request_id":"r3","user_id":"-","service":"recipi-api","env":"production"}'

LOGIN_FAILURE='{"time":"2026-09-16T00:00:00.000Z","level":"WARNING","logger":"app.audit","log_type":"audit","action":"auth.login","outcome":"failure","reason":"invalid_credentials","email_hash":"0123456789abcdef","client_ip":"203.0.113.7","request_id":"r4","user_id":"-","service":"recipi-api","env":"production","message":"audit: auth.login failure"}'
LOGIN_SUCCESS='{"time":"2026-09-16T00:00:00.000Z","level":"INFO","logger":"app.audit","log_type":"audit","action":"auth.login","outcome":"success","client_ip":"203.0.113.7","request_id":"r5","user_id":"u1","service":"recipi-api","env":"production","message":"audit: auth.login success"}'
LOGOUT_SUCCESS='{"time":"2026-09-16T00:00:00.000Z","level":"INFO","logger":"app.audit","log_type":"audit","action":"auth.logout","outcome":"success","client_ip":"203.0.113.7","request_id":"r6","user_id":"u1","service":"recipi-api","env":"production","message":"audit: auth.logout success"}'

TOKEN_REUSE='{"time":"2026-09-16T00:00:00.000Z","level":"WARNING","logger":"app.audit","log_type":"audit","action":"auth.refresh","outcome":"failure","reason":"token_reuse_detected","client_ip":"203.0.113.7","request_id":"r7","user_id":"u1","service":"recipi-api","env":"production","message":"audit: auth.refresh failure"}'

RATE_LIMITED_EMAIL='{"time":"2026-09-16T00:00:00.000Z","level":"WARNING","logger":"app.audit","log_type":"audit","action":"auth.password_reset.request","outcome":"failure","reason":"rate_limited_email","email_hash":"0123456789abcdef","client_ip":"203.0.113.7","request_id":"r8","user_id":"-","service":"recipi-api","env":"production","message":"audit: auth.password_reset.request failure"}'
RATE_LIMITED_IP='{"time":"2026-09-16T00:00:00.000Z","level":"WARNING","logger":"app.audit","log_type":"audit","action":"auth.password_reset.request","outcome":"failure","reason":"rate_limited_ip","email_hash":"0123456789abcdef","client_ip":"203.0.113.7","request_id":"r9","user_id":"-","service":"recipi-api","env":"production","message":"audit: auth.password_reset.request failure"}'
RESET_NOT_FOUND='{"time":"2026-09-16T00:00:00.000Z","level":"WARNING","logger":"app.audit","log_type":"audit","action":"auth.password_reset.request","outcome":"failure","reason":"not_found","email_hash":"0123456789abcdef","client_ip":"203.0.113.7","request_id":"r10","user_id":"-","service":"recipi-api","env":"production","message":"audit: auth.password_reset.request failure"}'

UNHANDLED='{"time":"2026-09-16T00:00:00.000Z","level":"ERROR","logger":"app","request_id":"r11","user_id":"-","service":"recipi-api","env":"production","message":"unhandled exception","exc_info":"Traceback (most recent call last): ..."}'

echo "=== メトリクスフィルタのパターンを検証します（aws logs test-metric-filter / 読み取りのみ・無料）"

# 5xx: 500 だけが一致（200・404 は一致しない）
check "5xx" '{ $.log_type = "access" && $.status >= 500 }' 1 \
  "${ACCESS_500}" "${ACCESS_200}" "${ACCESS_404}"

# ログイン失敗: 失敗の 1 件だけ（成功・ログアウトは一致しない）
check "login-failure" '{ $.log_type = "audit" && $.action = "auth.login" && $.outcome = "failure" }' 1 \
  "${LOGIN_FAILURE}" "${LOGIN_SUCCESS}" "${LOGOUT_SUCCESS}"

# トークン再利用: 該当の 1 件だけ（ログイン失敗は reason が違うので一致しない）
check "token-reuse" '{ $.log_type = "audit" && $.reason = "token_reuse_detected" }' 1 \
  "${TOKEN_REUSE}" "${LOGIN_FAILURE}"

# レート制限: email と ip の 2 件（not_found は一致しない）
check "reset-rate-limited" '{ $.log_type = "audit" && ($.reason = "rate_limited_email" || $.reason = "rate_limited_ip") }' 2 \
  "${RATE_LIMITED_EMAIL}" "${RATE_LIMITED_IP}" "${RESET_NOT_FOUND}"

# 想定外の例外: 完全一致の 1 件だけ（監査ログの message は一致しない）
check "unhandled-exception" '{ $.message = "unhandled exception" }' 1 \
  "${UNHANDLED}" "${LOGIN_SUCCESS}"

echo
if [ "${failures}" -eq 0 ]; then
  echo "すべてのパターンが期待どおりでした"
else
  echo "期待と違うパターンが ${failures} 件あります" >&2
  exit 1
fi
