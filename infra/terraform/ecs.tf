# ECS Fargate（API のコンテナを動かす）。
#
# - private サブネットに置き、公開 IP は付けない。外からは API Gateway（VPC Link）経由だけ。
# - タスクが起動すると、service_registries で Cloud Map に「IP とポート」が登録され、
#   API Gateway がそこへ転送する（service-discovery.tf）。
# - ログは awslogs ドライバで CloudWatch Logs の /ecs/recipi-api に送る。アプリは
#   1 行 1 JSON（Issue #170）。保存期間・アラームは Issue #172 で見直す。
# - 秘密（DATABASE_URL 等）は Secrets Manager から、起動時に環境変数として渡される。

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"
  tags = { Name = "${var.project_name}-cluster" }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project_name}-api"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_task_cpu
  memory                   = var.ecs_task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # GitHub Actions（ubuntu-latest）でビルドするイメージに合わせる
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${aws_ecr_repository.backend.repository_url}:${var.backend_image_tag}"
      essential = true

      portMappings = [{
        containerPort = var.app_port
        protocol      = "tcp"
      }]

      environment = [
        { name = "APP_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "INFO" },
        { name = "LOG_FORMAT", value = "json" },
        { name = "AUTH_COOKIE_SECURE", value = "true" },
        { name = "CORS_ALLOW_ORIGINS", value = var.cors_allow_origins },
        # 画像は AWS の S3。エンドポイントとアクセスキーは空にし、タスクロールの
        # 一時的な認証情報を使う（空を「AWS の標準・タスクロール」として扱う処理は Issue #166）。
        { name = "S3_ENDPOINT_URL", value = "" },
        { name = "S3_ACCESS_KEY_ID", value = "" },
        { name = "S3_SECRET_ACCESS_KEY", value = "" },
        { name = "S3_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = aws_s3_bucket.images.id },
        # 画像の URL は https://<CloudFront>/uploads/...（backend/app/services/image.py）。
        { name = "S3_PUBLIC_URL_BASE", value = "https://${aws_cloudfront_distribution.images.domain_name}" },
        # API Gateway の VPC Link の ENI が置かれる private サブネット。ここから来た
        # リクエストだけ、専用ヘッダー X-Recipi-Client-Ip をクライアントの IP として使う
        # （backend/app/request_utils.py。Issue #166）。VPC 全体にはしない。
        { name = "TRUSTED_PROXY_CIDRS", value = join(",", var.private_subnet_cidrs) },
      ]

      # 値は Secrets Manager から取り出される（Terraform にもタスク定義にも値は残らない）。
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "JWT_SECRET_KEY", valueFrom = aws_secretsmanager_secret.jwt_secret_key.arn },
        { name = "LOG_HASH_SECRET", valueFrom = aws_secretsmanager_secret.log_hash_secret.arn },
      ]

      # コンテナのヘルスチェック。slim のイメージには curl が無いので、Python 標準の
      # urllib で /healthz を叩く（200 以外や接続失敗なら例外 → 終了コード 1 = 異常）。
      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:${var.app_port}/healthz', timeout=3)\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  # 秘密の値が入る前にタスクが起動して失敗しないよう、値の書き込みを待つ。
  depends_on = [
    aws_secretsmanager_secret_version.database_url,
    aws_secretsmanager_secret_version.jwt_secret_key,
    aws_secretsmanager_secret_version.log_hash_secret,
  ]
}

# 初回の apply の前に、backend_image_tag のイメージを ECR に push しておくこと（README）。
# push していないと apply 自体は終わるが、タスクは CannotPullContainerError で起動しない。
resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for az in local.availability_zones : aws_subnet.private[az].id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  # Cloud Map に SRV（IP ＋ ポート）で登録する。API Gateway はここから転送先を知る。
  service_registries {
    registry_arn   = aws_service_discovery_service.api.arn
    container_name = local.container_name
    container_port = var.app_port
  }

  # NAT がある前にタスクが起動すると、イメージや秘密を取りに行けずに失敗する。
  depends_on = [aws_nat_gateway.main, aws_route_table_association.private]
}
