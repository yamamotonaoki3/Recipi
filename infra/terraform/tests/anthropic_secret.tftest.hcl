mock_provider "aws" {}

# AWSへ接続せずにplanを評価するため、既存構成が参照するdata sourceだけを固定する。
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

run "injects_anthropic_key_only_when_explicitly_enabled" {
  # AWSへは一切作成せず、タスク定義とIAMに共通で使う注入定義を検査する。
  command = plan

  variables {
    backend_image_tag          = "test-image"
    alert_email                = "alerts@example.com"
    enable_anthropic_proofread = true
  }

  assert {
    condition = contains(
      [for secret in local.ecs_task_secrets : secret.name],
      "ANTHROPIC_API_KEY",
    )
    error_message = "AI校正を有効化したときは、ECSへANTHROPIC_API_KEYをSecrets Manager経由で渡す必要があります。"
  }

  assert {
    condition     = length(local.ecs_task_execution_secret_arns) == 4
    error_message = "ECS実行ロールは、注入するAnthropic APIキーのSecretだけを取得できる必要があります。"
  }
}

run "does_not_inject_anthropic_key_by_default" {
  command = plan

  variables {
    backend_image_tag          = "test-image"
    alert_email                = "alerts@example.com"
    enable_anthropic_proofread = false
  }

  assert {
    condition = !contains(
      [for secret in local.ecs_task_secrets : secret.name],
      "ANTHROPIC_API_KEY",
    )
    error_message = "AI校正が未有効化の間は、Anthropic APIキーをECSタスクへ渡してはいけません。"
  }

  assert {
    condition     = length(local.ecs_task_execution_secret_arns) == 3
    error_message = "AI校正が未有効化の間は、ECS実行ロールへAnthropic APIキーの取得権限を追加してはいけません。"
  }
}
