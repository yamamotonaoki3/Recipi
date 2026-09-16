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

  # API Gateway が見たクライアントの IP を、専用ヘッダーに「上書き」で入れて ECS に渡す
  # （Issue #166）。上書きなので、クライアントが同じ名前のヘッダーを送っても偽装できない。
  # アプリは VPC Link（private サブネット）から来たときだけこのヘッダーを信じる
  # （backend/app/request_utils.py の CLIENT_IP_HEADER と名前をそろえる）。
  request_parameters = {
    "overwrite:header.x-recipi-client-ip" = "$context.identity.sourceIp"
  }
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

  # アクセスログ（Issue #172）。1 行 1 JSON で、アプリのログと同じように読める形にする。
  # **Authorization ヘッダーや Cookie は出さない**（秘密が混ざらないように）。
  # アプリのログの request_id とは別の値（API Gateway が振る requestId）なので、
  # 突き合わせ方は infra/terraform/README.md に書いてある。
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      ip                = "$context.identity.sourceIp"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      routeKey          = "$context.routeKey"
      status            = "$context.status"
      protocol          = "$context.protocol"
      responseLength    = "$context.responseLength"
      responseLatency   = "$context.responseLatency"
      integrationStatus = "$context.integrationStatus"
    })
  }

  # ロググループと、API Gateway に書き込みを許すポリシーができてから作る
  # （順番が逆だと、アクセスログが出ないまま作られてしまう）。
  depends_on = [aws_cloudwatch_log_resource_policy.api_gateway]
}
