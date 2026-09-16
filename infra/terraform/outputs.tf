# apply 後に `terraform output` で確認する値。秘密は出さない。

output "api_url" {
  description = "API の URL（例: <この値>/healthz）。フロントの EXPO_PUBLIC_API_BASE_URL に使う"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "images_cloudfront_domain" {
  description = "画像を配信する CloudFront のドメイン（アプリの S3_PUBLIC_URL_BASE に設定済み）"
  value       = aws_cloudfront_distribution.images.domain_name
}

output "images_bucket" {
  description = "画像バケットの名前（destroy の前に空にする）"
  value       = aws_s3_bucket.images.id
}

output "ecr_repository_url" {
  description = "backend のイメージを push する ECR リポジトリの URL"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  description = "ECS クラスタ名（aws ecs run-task などで使う）"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS サービス名"
  value       = aws_ecs_service.api.name
}

output "ecs_task_definition_family" {
  description = "タスク定義のファミリー名（デプロイ・マイグレーションで使う）"
  value       = aws_ecs_task_definition.api.family
}

output "ecs_container_name" {
  description = "タスク定義のコンテナ名（run-task の command 上書きで使う）"
  value       = local.container_name
}

output "private_subnet_ids" {
  description = "ECS を置く private サブネット（run-task で使う）"
  value       = [for az in local.availability_zones : aws_subnet.private[az].id]
}

output "ecs_security_group_id" {
  description = "ECS タスクのセキュリティグループ（run-task で使う）"
  value       = aws_security_group.ecs.id
}

output "api_log_group" {
  description = "API のログが届く CloudWatch Logs のロググループ"
  value       = aws_cloudwatch_log_group.api.name
}

output "alerts_topic_arn" {
  description = "アラームの通知先 SNS トピック（Issue #172。#173 のジョブ失敗通知でも使う）"
  value       = aws_sns_topic.alerts.arn
}

output "api_gateway_log_group" {
  description = "API Gateway のアクセスログのロググループ"
  value       = aws_cloudwatch_log_group.api_gateway.name
}

output "github_deploy_role_arn" {
  description = "GitHub Actions がデプロイで引き受けるロール。GitHub の Secrets の AWS_DEPLOY_ROLE_ARN に登録する"
  value       = aws_iam_role.github_deploy.arn
}
