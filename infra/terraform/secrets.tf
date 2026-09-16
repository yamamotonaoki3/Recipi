# 秘密（DB 接続・JWT の鍵・ログ用ハッシュの鍵）を Secrets Manager に入れる。
#
# 秘密の値を tfstate に一切残さない仕組み（Issue #165 の計画レビューで採用）:
# - 値は `ephemeral "random_password"` で作る。ephemeral（その場かぎり）なので
#   tfstate にも plan にも保存されない。
# - Secrets Manager・RDS には「書き込み専用の引数」（secret_string_wo / password_wo）で
#   渡す。AWS には送られるが、Terraform は値を覚えない。
# - 同じ apply の中では、同じ ephemeral の値が使われる。そのため RDS のパスワードと
#   DATABASE_URL の中のパスワードは一致する。
# - 書き込み専用の値は `*_wo_version` が変わったときだけ送られる。値を作り直すときは
#   下の *_version を 1 つ上げて apply する（DB は RDS と DATABASE_URL の両方を上げる）。
#
# ECS はタスクの起動時にここから値を取り出し、環境変数としてコンテナに渡す（ecs.tf）。
# ANTHROPIC_API_KEY は作らない: 値の入っていない秘密を参照すると ECS がタスクを
# 起動できないため。AI 機能（Phase 11）で足す。

locals {
  db_password_version  = 1
  jwt_secret_version   = 1
  log_hash_key_version = 1
}

ephemeral "random_password" "db" {
  length  = 32
  special = false # URL（DATABASE_URL）に入れても壊れないよう、記号は使わない
}

ephemeral "random_password" "jwt" {
  length  = 64
  special = false
}

ephemeral "random_password" "log_hash" {
  length  = 64
  special = false
}

# --- DATABASE_URL ---------------------------------------------------------------
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.project_name}/database-url"
  description             = "SQLAlchemy connection URL for the Recipi API"
  recovery_window_in_days = 0 # destroy → 再 apply で同じ名前を作り直せるように（学習用）
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # endpoint は「ホスト:5432」の形。psycopg 3 用のドライバ名を付ける（backend/app/db.py と同じ形式）。
  secret_string_wo = "postgresql+psycopg://${local.database_username}:${ephemeral.random_password.db.result}@${aws_db_instance.main.endpoint}/${local.database_name}"
  # RDS の password_wo_version と必ず同じ値にする。
  secret_string_wo_version = local.db_password_version
}

# --- JWT_SECRET_KEY -------------------------------------------------------------
resource "aws_secretsmanager_secret" "jwt_secret_key" {
  name                    = "${var.project_name}/jwt-secret-key"
  description             = "JWT signing key for the Recipi API"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "jwt_secret_key" {
  secret_id                = aws_secretsmanager_secret.jwt_secret_key.id
  secret_string_wo         = ephemeral.random_password.jwt.result
  secret_string_wo_version = local.jwt_secret_version
}

# --- LOG_HASH_SECRET（監査ログの email_hash の鍵。Issue #170） -------------------
resource "aws_secretsmanager_secret" "log_hash_secret" {
  name                    = "${var.project_name}/log-hash-secret"
  description             = "HMAC key for email_hash in audit logs"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "log_hash_secret" {
  secret_id                = aws_secretsmanager_secret.log_hash_secret.id
  secret_string_wo         = ephemeral.random_password.log_hash.result
  secret_string_wo_version = local.log_hash_key_version
}
