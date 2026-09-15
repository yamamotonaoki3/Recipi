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

  # コンテナ名（タスク定義・Cloud Map の登録・ログで共通に使う）。
  container_name = "api"

  common_tags = merge(
    {
      Project   = var.project_name
      ManagedBy = "Terraform"
    },
    var.tags
  )
}
