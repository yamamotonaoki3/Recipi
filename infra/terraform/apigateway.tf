# API の入口: API Gateway HTTP API ＋ VPC Link ＋ Cloud Map。
#
#   クライアント ─HTTPS─> HTTP API ─ VPC Link ─> Cloud Map(SRV) ─> ECS(private):8000
#
# ALB を使わない理由: ALB は動いているだけで固定費がかかる。HTTP API は
# リクエスト数に応じた課金なので、学習用で使う時間が短い Recipi では安い。
# HTTPS は API Gateway の既定のドメイン（*.execute-api.<region>.amazonaws.com）の
# 証明書で終端する（独自ドメインは使わない）。

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
  description   = "Recipi API (HTTP API -> VPC Link -> ECS)"
}

resource "aws_apigatewayv2_vpc_link" "main" {
  name               = "${var.project_name}-vpclink"
  subnet_ids         = [for az in local.availability_zones : aws_subnet.private[az].id]
  security_group_ids = [aws_security_group.vpclink.id]
}

# すべてのリクエストを、そのまま（HTTP_PROXY）Cloud Map の api サービスへ転送する。
resource "aws_apigatewayv2_integration" "api" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.main.id
  integration_uri    = aws_service_discovery_service.api.arn
}

# `$default` ルート = どのパス・メソッドにも一致する既定のルート。
resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# `$default` ステージ = URL にステージ名が付かない（https://<id>.execute-api.../api/v1/...）。
# 変更は自動でデプロイする。アクセスログは Issue #172 で足す。
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # 大量のリクエストで課金やサーバーへの負荷が増えすぎないよう、入口で絞る。
  default_route_settings {
    throttling_rate_limit  = var.api_throttle_rate_limit
    throttling_burst_limit = var.api_throttle_burst_limit
  }
}
