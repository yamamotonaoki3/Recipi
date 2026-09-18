locals {
  # 2 つの AZ を使う（RDS のサブネットグループは 2 AZ 以上が必須のため）。
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)

  # AZ 名 → CIDR の対応表（for_each でサブネットを作るため）。
  public_subnets = {
    for index, az in local.availability_zones : az => var.public_subnet_cidrs[index]
  }
  private_subnets = {
    for index, az in local.availability_zones : az => var.private_subnet_cidrs[index]
  }

  # NAT Gateway は 1 つだけ、1 つ目の AZ の public サブネットに置く（固定費を抑えるため）。
  # この AZ が止まると、もう一方の AZ の ECS も外に出られなくなる（既知のトレードオフ）。
  nat_availability_zone = local.availability_zones[0]

  database_name     = "recipi"
  database_username = "recipi_app"

  # コンテナ名（タスク定義・ALBターゲット登録・ログで共通に使う）。
  container_name = "api"

  # ECS の起動時に Secrets Manager から注入する値と、その取得を許可する ARN。
  # Anthropic のキーは利用者が値を登録し、明示的に有効化した場合だけ加える。
  # 同じ定義をタスク定義と IAM ポリシーで共有し、注入対象と権限のずれを防ぐ。
  ecs_task_secrets = concat(
    [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "JWT_SECRET_KEY", valueFrom = aws_secretsmanager_secret.jwt_secret_key.arn },
      { name = "LOG_HASH_SECRET", valueFrom = aws_secretsmanager_secret.log_hash_secret.arn },
    ],
    var.enable_anthropic_proofread ? [
      { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
    ] : [],
  )

  ecs_task_execution_secret_arns = [for secret in local.ecs_task_secrets : secret.valueFrom]

  # このアカウントの ID（IAM・SNS・ログのポリシーの条件で使う）。
  account_id = data.aws_caller_identity.current.account_id

  common_tags = merge(
    {
      Project   = var.project_name
      ManagedBy = "Terraform"
    },
    var.tags
  )
}
