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

run "passes_the_image_dimension_to_the_ecs_task" {
  command = plan

  variables {
    backend_image_tag   = "test-image"
    alert_email         = "alerts@example.com"
    image_max_dimension = 1536
  }

  assert {
    condition = one([
      for setting in local.ecs_task_environment : setting.value
      if setting.name == "IMAGE_MAX_DIMENSION"
    ]) == tostring(var.image_max_dimension)
    error_message = "ECSのAPIコンテナはimage_max_dimensionをIMAGE_MAX_DIMENSIONとして受け取る必要があります。"
  }
}
