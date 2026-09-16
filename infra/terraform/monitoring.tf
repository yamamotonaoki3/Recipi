# 監視（CloudWatch のログ・メトリクス・アラーム・通知）。Issue #172。
#
# 考え方:
# - アプリは 1 行 1 JSON のログを出す（Issue #170）。その JSON の項目を
#   **メトリクスフィルタ**で数え、**アラーム**でしきい値を超えたら SNS でメールを送る。
# - アプリのログと監査ログは同じロググループ（/ecs/recipi-api）に入れて 365 日残す
#   （監査ログを 1 年残す要件。docs/requirements/non-functional.md §ログ）。
# - 「データなし」の扱いはアラームの性質で分ける:
#   ログから数えるもの  → notBreaching（アクセスが無い時間帯に誤って鳴らせない）
#   動いているはずのもの → breaching（メトリクスが途切れること自体が異常）

# --- API Gateway のアクセスログ -----------------------------------------------
resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.project_name}-api"
  retention_in_days = 30 # 入口の記録。監査ログではないので 30 日で十分
}

# API Gateway が上のロググループに書き込めるようにする。
# これが無いと、ロググループはできてもアクセスログが 1 行も出ない。
resource "aws_cloudwatch_log_resource_policy" "api_gateway" {
  policy_name = "${var.project_name}-apigateway-logs"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
      Action    = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource  = "${aws_cloudwatch_log_group.api_gateway.arn}:*"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })
}

# --- 通知（SNS のメール） -----------------------------------------------------
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

# CloudWatch のアラームと EventBridge から発行できるようにする（自アカウントに限定）。
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["cloudwatch.amazonaws.com", "events.amazonaws.com"] }
      Action    = "SNS:Publish"
      Resource  = aws_sns_topic.alerts.arn
      Condition = {
        StringEquals = { "AWS:SourceAccount" = local.account_id }
      }
    }]
  })
}

# apply の後、AWS から届く確認メールのリンクを押すまで通知は来ない（README）。
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# --- メトリクスフィルタ（JSON ログの項目を数える） ----------------------------
# パターンの書式は CloudWatch Logs の JSON フィルタ。実際のログで一致するかは
# infra/scripts/test-metric-filters.sh（aws logs test-metric-filter）で検証する。
locals {
  metric_namespace = "Recipi/Api"

  log_metric_filters = {
    # 5xx（アクセスログの status は数値）
    "5xx" = {
      pattern     = "{ $.log_type = \"access\" && $.status >= 500 }"
      metric_name = "Api5xxCount"
    }
    # ログイン失敗（総当たりの気配を見る）
    "login-failure" = {
      pattern     = "{ $.log_type = \"audit\" && $.action = \"auth.login\" && $.outcome = \"failure\" }"
      metric_name = "LoginFailureCount"
    }
    # リフレッシュトークンの再利用（盗用の疑い）
    "token-reuse" = {
      pattern     = "{ $.log_type = \"audit\" && $.reason = \"token_reuse_detected\" }"
      metric_name = "TokenReuseCount"
    }
    # パスワード再設定のレート制限
    "reset-rate-limited" = {
      pattern     = "{ $.log_type = \"audit\" && ($.reason = \"rate_limited_email\" || $.reason = \"rate_limited_ip\") }"
      metric_name = "PasswordResetRateLimitedCount"
    }
    # 想定外の例外。
    # この "unhandled exception" という文字列は backend/app/middleware.py が出し、
    # backend/tests/test_logging.py が完全一致で検査している「契約」。
    # メッセージを変えるときは、必ずこのパターンも直すこと（逆も同じ）。
    "unhandled-exception" = {
      pattern     = "{ $.message = \"unhandled exception\" }"
      metric_name = "UnhandledExceptionCount"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "app" {
  for_each = local.log_metric_filters

  name           = "${var.project_name}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = each.value.pattern

  metric_transformation {
    name      = each.value.metric_name
    namespace = local.metric_namespace
    value     = "1"
    # ログを処理したがパターンに一致しなかったときに 0 を入れる。
    # （ログが 1 件も来ない期間はデータ点そのものが作られない。そのため
    #   「データなし」の扱いは下のアラームで明示している）
    default_value = "0"
  }
}

# --- アラーム（ログから数えるもの。データなしは正常扱い） ----------------------
locals {
  log_alarms = {
    "5xx" = {
      metric_name        = "Api5xxCount"
      threshold          = 5
      period             = 300
      evaluation_periods = 1
      description        = "5 分間に 5xx が 5 件以上（サーバー内部エラーの急増）"
    }
    "login-failure" = {
      metric_name        = "LoginFailureCount"
      threshold          = 20
      period             = 300
      evaluation_periods = 1
      description        = "5 分間にログイン失敗が 20 件以上（総当たりの疑い）"
    }
    "token-reuse" = {
      metric_name        = "TokenReuseCount"
      threshold          = 1
      period             = 300
      evaluation_periods = 1
      description        = "リフレッシュトークンの再利用を検知（盗用の疑い）"
    }
    "reset-rate-limited" = {
      metric_name        = "PasswordResetRateLimitedCount"
      threshold          = 10
      period             = 900
      evaluation_periods = 1
      description        = "15 分間にパスワード再設定のレート制限が 10 件以上"
    }
    "unhandled-exception" = {
      metric_name        = "UnhandledExceptionCount"
      threshold          = 1
      period             = 300
      evaluation_periods = 1
      description        = "想定外の例外が発生"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "log_based" {
  for_each = local.log_alarms

  alarm_name          = "${var.project_name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = local.metric_namespace
  metric_name         = each.value.metric_name
  statistic           = "Sum"
  period              = each.value.period
  evaluation_periods  = each.value.evaluation_periods
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # アクセスが無い時間帯（ログが来ない）は正常として扱う。
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn] # 直ったときも知らせる
}

# --- アラーム（サービスが動いているか。データなしは異常扱い） ------------------
# ECS の CPUUtilization は「タスクが動いていれば必ず出る」標準メトリクス。
# そのため、値そのものではなく **メトリクスが来ないこと** を異常として使う
# （しきい値 100% 超えは通常起きないので、鳴るのは実質「データなし」のときだけ）。
# タスク数そのもの（RunningTaskCount）は Container Insights が必要なので使わない
# （有効にすると観測データごとの課金が増えるため）。
resource "aws_cloudwatch_metric_alarm" "ecs_service_alive" {
  alarm_name          = "${var.project_name}-ecs-service-not-running"
  alarm_description   = "ECS サービスのメトリクスが届かない（タスクが動いていない可能性）"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.api.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# 外から見た異常（ECS に届かないときは API Gateway が 5xx を返す）。
# HTTP API（v2）のメトリクス名は `5xx`（REST API の 5XXError ではない）。
# ディメンションは ApiId ＋ Stage の組で出るので、両方を指定する。
resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  alarm_name          = "${var.project_name}-apigateway-5xx"
  alarm_description   = "API Gateway が 5 分間に 5xx を 5 件以上返した"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.main.id
    Stage = aws_apigatewayv2_stage.default.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# --- アラーム（RDS） ----------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.project_name}-rds-cpu-high"
  alarm_description   = "RDS の CPU が 80% 以上で 15 分続いた"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  # DB の停止は下の空き容量のアラームで捕まえるので、ここでは二重に鳴らさない。
  treat_missing_data = "missing"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name        = "${var.project_name}-rds-free-storage-low"
  alarm_description = "RDS の空き容量が 2GB を下回った（またはメトリクスが届かない）"
  namespace         = "AWS/RDS"
  metric_name       = "FreeStorageSpace"
  statistic         = "Minimum"
  period            = 300
  # FreeStorageSpace は「バイト」単位。2GB = 2 * 1024^3。
  threshold           = 2147483648
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# --- Logs Insights の保存クエリ（調査でよく使うものを登録しておく） ------------
resource "aws_cloudwatch_query_definition" "login_failures" {
  name            = "${var.project_name}/ログイン失敗をアドレスごとに数える"
  log_group_names = [aws_cloudwatch_log_group.api.name]

  query_string = <<-QUERY
    fields @timestamp, email_hash, client_ip
    | filter log_type = "audit" and action = "auth.login" and outcome = "failure"
    | stats count() as failures by email_hash
    | sort failures desc
  QUERY
}

resource "aws_cloudwatch_query_definition" "by_request_id" {
  name            = "${var.project_name}/request_id で 1 リクエストを追う"
  log_group_names = [aws_cloudwatch_log_group.api.name]

  query_string = <<-QUERY
    fields @timestamp, level, logger, message, log_type, action, status
    | filter request_id = "REPLACE_WITH_X_REQUEST_ID"
    | sort @timestamp asc
  QUERY
}

resource "aws_cloudwatch_query_definition" "slow_endpoints" {
  name            = "${var.project_name}/遅いエンドポイントを探す"
  log_group_names = [aws_cloudwatch_log_group.api.name]

  query_string = <<-QUERY
    fields path, duration_ms
    | filter log_type = "access"
    | stats avg(duration_ms) as avg_ms, max(duration_ms) as max_ms, count() as requests by path
    | sort avg_ms desc
  QUERY
}
