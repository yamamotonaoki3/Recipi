# 定期ジョブ（EventBridge Scheduler → ECS RunTask）。Issue #173。
#
# 考え方（docs/requirements/processing-model.md §3・§8）:
# - 常駐のワーカーは置かず、「決まった時刻に管理コマンドを 1 回だけ動かす」方式。
#   API と同じイメージ・同じタスク定義を使い、command だけを上書きする。
# - 各ジョブは同時に 2 本走っても壊れない作り（FOR UPDATE SKIP LOCKED や
#   ユーザー単位の advisory lock。Issue #72・#85）。そのためスケジューラ側で
#   排他はしない。頻度は 1 回の実行時間より十分長くしている。
# - 失敗は 4 通りの経路で拾う（下の「失敗の検知」）。通知先は #172 の SNS。

# --- スケジュールグループ（まとめて見る・まとめて消す） -----------------------
resource "aws_scheduler_schedule_group" "jobs" {
  name = "${var.project_name}-jobs"
}

# --- スケジューラ用の IAM ロール ---------------------------------------------
# 「このスケジュールグループからの呼び出しだけ」がこのロールを使える（混乱した代理人対策）。
locals {
  # EventBridge Scheduler の実行ロールをスケジュールグループ単位に限定する。
  # aws:SourceArn に個別スケジュール ARN を指定すると、CreateSchedule 時の
  # 引受検証に一致せずスケジュールを作成できない。
  scheduler_execution_role_source_arn_condition = "StringEquals"
  scheduler_execution_role_source_arn           = "arn:aws:scheduler:${var.aws_region}:${local.account_id}:schedule-group/${aws_scheduler_schedule_group.jobs.name}"
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      # EventBridge Scheduler の aws:SourceArn は、実行ロールの信頼ポリシーでは
      # スケジュールグループ ARN（...:schedule-group/<グループ名>）に限定する。
      # 個別スケジュール ARN やワイルドカードを指定すると、CreateSchedule 時の
      # 実行ロール引受検証に一致しない。
      test     = local.scheduler_execution_role_source_arn_condition
      variable = "aws:SourceArn"
      values   = [local.scheduler_execution_role_source_arn]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project_name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.project_name}-scheduler"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # タスク定義のリビジョンは #167 のデプロイで上がるので、末尾は :* にする。
        Sid      = "RunJobTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "${local.task_definition_arn_base}:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        # RunTask にタグ（recipi:job。下の aws_scheduler_schedule）を渡すには
        # ecs:TagResource も要る（無いと AccessDenied。Issue #341）。
        # タグ付け対象は「起動されたタスク」（task-definition ではなく task の ARN）。
        # Issue #341 では task_definition_arn_base に付けてしまい直っていなかった（Issue #343）。
        Sid      = "TagJobTask"
        Effect   = "Allow"
        Action   = ["ecs:TagResource"]
        Resource = "arn:aws:ecs:${var.aws_region}:${local.account_id}:task/${aws_ecs_cluster.main.name}/*"
      },
      {
        # タスク定義に書いてある 2 つのロールを ECS に渡す権限（ECS 以外には渡せない）。
        Sid      = "PassEcsRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.ecs_task_execution.arn, aws_iam_role.ecs_task.arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# --- スケジュール 8 本 --------------------------------------------------------
# 頻度の考え方:
# - 数分〜数十分で回収したいもの（通知の配り直し・ストレージの実削除）は短い間隔。
# - 1 日遅れても困らない掃除・数え直しは日次。DB のロックを取り合わないよう 10 分ずつずらす。
# - cron は UTC。日本時間はコメントに書く。
locals {
  # 失敗の通知で「定期ジョブのタスク」と「API のタスク」を見分けるためのタグ。
  # ジョブ側はスケジューラが起動時に付け（下の aws_scheduler_schedule）、
  # API 側はタスク定義のタグをサービスが伝播させる（ecs.tf）。
  job_tag_key = "recipi:job"
  api_tag_key = "recipi:component"

  scheduled_jobs = {
    "notification-sweep" = {
      module     = "notification_sweep"
      expression = "rate(10 minutes)"
      note       = "BackgroundTasks の取りこぼしを回収する"
    }
    "storage-deletion" = {
      module     = "storage_deletion"
      expression = "rate(15 minutes)"
      note       = "削除キューのオブジェクトを S3 から実削除する"
    }
    "gc-uploads" = {
      module     = "gc_uploads"
      expression = "rate(1 hour)"
      note       = "参照されないままの一時アップロードを回収する"
    }
    "cleanup-refresh-tokens" = {
      module     = "cleanup_refresh_tokens"
      expression = "cron(10 17 * * ? *)" # 日本時間 2:10
      note       = "期限切れのリフレッシュトークンのチェーンを消す"
    }
    "cleanup-notifications" = {
      module     = "cleanup_notifications"
      expression = "cron(20 17 * * ? *)" # 日本時間 2:20
      note       = "古い既読通知と処理済み outbox を消す"
    }
    "cleanup-password-reset-attempts" = {
      module     = "cleanup_password_reset_attempts"
      expression = "cron(30 17 * * ? *)" # 日本時間 2:30
      note       = "パスワード再設定の試行記録（メール・IP）を消す"
    }
    "cleanup-reauth-attempts" = {
      module     = "cleanup_reauth_attempts"
      expression = "cron(35 17 * * ? *)" # 日本時間 2:35
      note       = "再認証（現パスワード確認）の試行記録（IP）を消す"
    }
    "trim-recipe-views" = {
      module     = "trim_recipe_views"
      expression = "cron(40 17 * * ? *)" # 日本時間 2:40
      note       = "閲覧履歴を 1 ユーザー 200 件に収める"
    }
    "recount-counts" = {
      module     = "recount_counts"
      expression = "cron(50 17 * * ? *)" # 日本時間 2:50
      note       = "カウント列のズレを実数から直す"
    }
  }
}

resource "aws_scheduler_schedule" "jobs" {
  for_each = local.scheduled_jobs

  name                = "${var.project_name}-${each.key}"
  group_name          = aws_scheduler_schedule_group.jobs.name
  description         = each.value.note
  schedule_expression = each.value.expression
  state               = var.schedules_enabled ? "ENABLED" : "DISABLED"

  # 指定した時刻ぴったりに動かす（ずらさない）。
  flexible_time_window {
    mode = "OFF"
  }

  target {
    # Universal Target: AWS SDK の ecs:RunTask をそのまま呼ぶ。
    arn      = "arn:aws:scheduler:::aws-sdk:ecs:runTask"
    role_arn = aws_iam_role.scheduler.arn

    # 失敗しても再試行しない（次回の実行で回収できる設計。二重起動も避ける）。
    retry_policy {
      maximum_retry_attempts = 0
    }

    # キー名は AWS SDK の RunTask のリクエストに合わせる。
    # TaskDefinition は「ファミリー名」だけにして、リビジョンを固定しない
    # （#167 のデプロイで上がった最新が使われる）。
    input = jsonencode({
      TaskDefinition = aws_ecs_task_definition.api.family
      Cluster        = aws_ecs_cluster.main.arn
      LaunchType     = "FARGATE"
      Count          = 1
      NetworkConfiguration = {
        AwsvpcConfiguration = {
          Subnets        = [for az in local.availability_zones : aws_subnet.private[az].id]
          SecurityGroups = [aws_security_group.ecs.id]
          AssignPublicIp = "DISABLED"
        }
      }
      Overrides = {
        ContainerOverrides = [{
          Name    = local.container_name
          Command = ["python", "-m", "app.jobs.${each.value.module}"]
        }]
      }
      # 起動したタスクに「これは定期ジョブ」という印を付ける。
      # API のサービスが動かすタスクには付かないので、失敗の通知を
      # 「ジョブの失敗」と「API の異常終了」に区別できる（下の EventBridge のルール）。
      PropagateTags = "TASK_DEFINITION"
      Tags = [
        { Key = local.job_tag_key, Value = each.key },
      ]
    })
  }
}

# --- 失敗の検知 ---------------------------------------------------------------
# ルールは「定期ジョブのタスク」と「API のタスク」を分ける。
# ジョブと API は同じクラスタ・同じタスク定義を使うので、分けないと
# **通常のデプロイで古い API タスクが止まるたびに「ジョブが失敗」と通知**されてしまう。
# 見分けには、スケジューラが起動時に付けるタグ（recipi:job）を使う。
#
# (a) 定期ジョブのタスクが 0 以外の終了コードで終わった
resource "aws_cloudwatch_event_rule" "job_task_failed" {
  name        = "${var.project_name}-job-task-failed"
  description = "定期ジョブのタスクが 0 以外の終了コードで停止した"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      containers = {
        exitCode = [{ "anything-but" : [0] }]
      }
      # このタグが付いているのは、スケジューラが起動したタスクだけ。
      tags = {
        key = [local.job_tag_key]
      }
    }
  })
}

# (b) 定期ジョブのタスクが起動しなかった（終了コードが付かない失敗）
resource "aws_cloudwatch_event_rule" "job_task_failed_to_start" {
  name        = "${var.project_name}-job-task-failed-to-start"
  description = "定期ジョブのタスクが起動できずに停止した（stopCode = TaskFailedToStart）"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      stopCode   = ["TaskFailedToStart"]
      tags = {
        key = [local.job_tag_key]
      }
    }
  })
}

# (a2) API（サービス）のタスクが起動できずに停止した。
# 終了コードが 0 以外での停止は、デプロイや再起動でも起きるため通知しない
# （API の異常は #172 の 5xx・ECS のメトリクス・ヘルスチェックで気づく）。
# 「起動すらできない」はデプロイの失敗を意味するので、これだけ通知する。
#
# 見分け方: 「ジョブのタグが無い」だけでは判定できない。ECS のイベントの `tags` は
# **タグの伝播を設定していないと項目そのものが存在せず**、`anything-but` は
# 「その項目がある」ことが前提なので一致しないため（Codex 指摘・P2）。
# そこで ECS サービス側にもタグを伝播させ（ecs.tf の propagate_tags）、
# 「Project タグはあるが recipi:job は無い」で判定する。
resource "aws_cloudwatch_event_rule" "api_task_failed_to_start" {
  name        = "${var.project_name}-api-task-failed-to-start"
  description = "API のタスクが起動できずに停止した（イメージや秘密の取得に失敗した可能性）"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      stopCode   = ["TaskFailedToStart"]
      # API のサービスにだけ付けるタグで判定する（ecs.tf の tags）。
      # 「Project があって recipi:job が無い」と書きたくなるが、イベントパターンの
      # 配列は「どれかが一致すれば真」なので AND にはならず、ジョブ（Project も付く）
      # まで一致してしまう。専用のタグを 1 つ用意するのが確実。
      tags = {
        key = [local.api_tag_key]
      }
    }
  })
}

# メールの本文は、原因を追える最低限だけにする（ログ本文は入れない）。
resource "aws_cloudwatch_event_target" "job_task_failed" {
  rule      = aws_cloudwatch_event_rule.job_task_failed.name
  target_id = "sns"
  arn       = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      stoppedReason = "$.detail.stoppedReason"
      stopCode      = "$.detail.stopCode"
      taskArn       = "$.detail.taskArn"
    }
    input_template = <<-TEMPLATE
      "定期ジョブが異常終了しました。stopCode=<stopCode> stoppedReason=<stoppedReason> taskArn=<taskArn> 詳細は CloudWatch Logs の /ecs/${var.project_name}-api を、logger が app.jobs で始まる行で確認してください。"
    TEMPLATE
  }
}

resource "aws_cloudwatch_event_target" "job_task_failed_to_start" {
  rule      = aws_cloudwatch_event_rule.job_task_failed_to_start.name
  target_id = "sns"
  arn       = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      stoppedReason = "$.detail.stoppedReason"
      taskArn       = "$.detail.taskArn"
    }
    input_template = <<-TEMPLATE
      "定期ジョブのタスクが起動できませんでした（イメージや秘密の取得に失敗した可能性）。stoppedReason=<stoppedReason> taskArn=<taskArn>"
    TEMPLATE
  }
}

resource "aws_cloudwatch_event_target" "api_task_failed_to_start" {
  rule      = aws_cloudwatch_event_rule.api_task_failed_to_start.name
  target_id = "sns"
  arn       = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      stoppedReason = "$.detail.stoppedReason"
      taskArn       = "$.detail.taskArn"
    }
    input_template = <<-TEMPLATE
      "API のタスクが起動できませんでした（デプロイの失敗の可能性）。stoppedReason=<stoppedReason> taskArn=<taskArn>"
    TEMPLATE
  }
}

# (c) スケジューラが RunTask を呼べなかった（IAM エラー・スロットリング等。
#     この場合 ECS のイベントは出ないので、Scheduler 側のメトリクスで見る）
resource "aws_cloudwatch_metric_alarm" "scheduler_failed_invocations" {
  alarm_name        = "${var.project_name}-scheduler-invocation-failed"
  alarm_description = "EventBridge Scheduler がジョブを起動できなかった（IAM エラー・スロットリング等）"
  namespace         = "AWS/Scheduler"
  # ターゲット（ECS の RunTask）の呼び出しが失敗した回数。
  # ディメンションはスケジュールグループ単位。apply 後に
  # `aws cloudwatch list-metrics --namespace AWS/Scheduler` で実際の名前と
  # ディメンションを確かめる（まとめ確認の項目）。
  metric_name         = "TargetErrorCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ScheduleGroup = aws_scheduler_schedule_group.jobs.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# (d) ジョブは終了コード 0 で終わるが、中で失敗を積み残している場合
#     （storage_deletion は個別の削除失敗を warning、notification_sweep は
#      1 件の配布失敗を exception=ERROR で記録し、次回に回す作り）。
#     (a)〜(c) では気づけないので、ログの件数をメトリクスにして見る。
locals {
  job_failure_filters = {
    "job-storage-deletion-failure" = {
      pattern     = "{ $.logger = \"app.jobs.storage_deletion\" && $.level = \"WARNING\" }"
      metric_name = "StorageDeletionFailureCount"
      threshold   = 10
      description = "ストレージ削除ジョブの失敗が 1 時間で 10 件以上（再試行の上限に達した行が増えている可能性）"
    }
    "job-notification-sweep-failure" = {
      pattern     = "{ $.logger = \"app.jobs.notification_sweep\" && $.level = \"ERROR\" }"
      metric_name = "NotificationSweepFailureCount"
      threshold   = 5
      description = "通知スイープの配布失敗が 1 時間で 5 件以上"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "job_failures" {
  for_each = local.job_failure_filters

  name           = "${var.project_name}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = each.value.pattern

  metric_transformation {
    name          = each.value.metric_name
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "job_failures" {
  for_each = local.job_failure_filters

  alarm_name          = "${var.project_name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = local.metric_namespace
  metric_name         = each.value.metric_name
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching" # ジョブが動いていない時間帯は正常

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
