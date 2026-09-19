mock_provider "aws" {}

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

run "trusts_only_the_immutable_main_subject" {
  command = plan

  variables {
    backend_image_tag = "test-image"
    alert_email       = "alerts@example.com"
  }

  assert {
    condition     = local.github_oidc_subject == "repo:yamamotonaoki3@210459743/Recipi@1351369041:ref:refs/heads/main"
    error_message = "GitHubのOIDC不変subject形式で、mainブランチだけを許可する必要があります。"
  }
}
