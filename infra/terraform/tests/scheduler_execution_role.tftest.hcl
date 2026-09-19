mock_provider "aws" {}

# AWSへ接続せずに、EventBridge Scheduler が引き受ける実行ロールの
# 信頼ポリシーだけを検証する。
override_data {
  target = data.aws_availability_zones.available
  values = {
    names = ["ap-northeast-1a", "ap-northeast-1c"]
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

override_data {
  target = data.aws_iam_policy_document.ecs_tasks_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.scheduler_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

run "limits_scheduler_assumption_to_the_schedule_group" {
  command = plan

  variables {
    backend_image_tag = "test-image"
    alert_email       = "alerts@example.com"
  }

  assert {
    condition = local.account_id == "123456789012"

    error_message = "Scheduler実行ロールは、このAWSアカウントからの引受だけを許可する必要があります。"
  }

  assert {
    condition = local.scheduler_execution_role_source_arn_condition == "StringEquals"

    error_message = "Scheduler実行ロールのSourceArnは、ワイルドカードを許容するArnLikeではなくStringEqualsで制限する必要があります。"
  }

  assert {
    condition = local.scheduler_execution_role_source_arn == "arn:aws:scheduler:ap-northeast-1:123456789012:schedule-group/recipi-jobs"

    error_message = "Scheduler実行ロールのSourceArnは、個別スケジュールではなくrecipi-jobsスケジュールグループARNに完全一致させる必要があります。"
  }
}
