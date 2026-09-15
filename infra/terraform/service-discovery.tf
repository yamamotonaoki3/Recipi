# Cloud Map（サービスディスカバリ）。
#
# API Gateway HTTP API は、VPC Link の先の宛先として Cloud Map のサービスを指定できる
# （ALB を置かずに済むので固定費が下がる）。API Gateway は Cloud Map の
# DiscoverInstances で「今動いている ECS タスクの IP とポート」を取得して転送する。
#
# SRV レコードにする理由: IP（AWS_INSTANCE_IPV4）とポート（AWS_INSTANCE_PORT）の両方を
# 登録するため。A レコードだとポートが登録されず、API Gateway が転送先を決められない。
# ECS サービスの service_registries（ecs.tf）がタスクの起動・停止に合わせて自動で登録・解除する。

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.project_name}.internal"
  description = "Private namespace for ${var.project_name} services"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "SRV"
    }
  }

  # ECS のコンテナのヘルスチェック結果を Cloud Map の状態に反映する
  # （異常なタスクには API Gateway が転送しない）。
  health_check_custom_config {}
}
