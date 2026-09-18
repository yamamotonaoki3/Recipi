# ECS Fargate（API のコンテナを動かす）。
#
# - private サブネットに置き、公開 IP は付けない。外からは API Gateway（VPC Link）経由だけ。
# - タスクは内部ALBのターゲットグループへ登録され、ALBがヘルスチェックと振り分けを行う。
# - ログは awslogs ドライバで CloudWatch Logs の /ecs/recipi-api に送る。アプリは
#   1 行 1 JSON（Issue #170）。保存期間・アラームは Issue #172 で見直す。
# - 秘密（DATABASE_URL 等）は Secrets Manager から、起動時に環境変数として渡される。

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"
  tags = { Name = "${var.project_name}-cluster" }
}

resource "aws_cloudwatch_log_group" "api" {
  name = "/ecs/${var.project_name}-api"
  # アプリのログと監査ログ（Issue #170）を同じロググループに入れ、
  # **監査ログを 1 年残す**要件に合わせて 365 日にする（Issue #172）。
  # 量が増えて月 5GB を超えるようなら、監査ログを別のロググループに分ける
  # （判断基準は infra/terraform/README.md）。
  retention_in_days = 365
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
        # DB 接続プール。1タスクあたり同時20本（10 ＋ 予備10）まで、空き待ちは5秒。
        # 待ちきれない分は 500 ではなく 503 ＋ Retry-After を返して早く手放す。
        # RDS db.t4g.micro の max_connections（約 110）に対し、定期ジョブ・
        # マイグレーション・手動接続の分を残せる範囲にしている。
        { name = "DB_POOL_SIZE", value = tostring(var.db_pool_size) },
        { name = "DB_MAX_OVERFLOW", value = tostring(var.db_max_overflow) },
        { name = "DB_POOL_TIMEOUT_SECONDS", value = "5" },
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
        # AI 校正のプロバイダ（Issue #199）。**明示しないと既定の "local"（Ollama）に
        # なり、ECS には Ollama が居ないので毎回 15 秒のタイムアウトを待ってから 503 に
        # なる**（その間スレッドを占有する）。本番は "anthropic" を指定する。
        #
        # APIキーはSecrets Managerから注入する。空のSecretを参照するとタスク自体が
        # 起動できないため、値の手動登録を終えて `enable_anthropic_proofread=true` に
        # した場合だけ下のsecretsブロックへ加える。
        { name = "AI_PROVIDER", value = "anthropic" },
      ]

      # 値は Secrets Manager から取り出される。ここで値を文字列として書かず、
      # SecretのARNだけをECSへ渡す。値はtfstateにも
      # タスク定義にも残らず、起動時にECSエージェントが実行ロールで取得する。
      # 値の登録前にtrueにするとタスク起動が失敗するため、手順書の順序を守ること。
      # `concat` によりfalse時はANTHROPIC_API_KEY自体がタスク定義に現れない。
      secrets = local.ecs_task_secrets

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

  # このタグはサービスがタスクへ伝える（下の propagate_tags）。ECS のイベントに
  # tags が載り、失敗の通知で「API のタスク」と「定期ジョブのタスク」を見分けられる
  # （ジョブ側はスケジューラが recipi:job を付ける。infra/terraform/scheduler.tf。Issue #173）。
  tags = {
    (local.api_tag_key) = "api"
  }
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

  # デプロイのサーキットブレーカー（Issue #167）。新しいタスクが安定して起動できない
  # デプロイを ECS 自身が失敗と判断し、直前の安定したタスク定義へ自動で戻す。
  # デプロイのワークフローが中断されても効く（ワークフロー側のロールバックと二重の備え）。
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # タスク定義のタグ（default_tags の Project など）をタスクにも伝える。
  # ECS のイベントに tags が載るようになり、「定期ジョブのタスク」と
  # 「API のタスク」を失敗通知で見分けられる（scheduler.tf。Issue #173）。
  propagate_tags = "TASK_DEFINITION"

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = local.container_name
    container_port   = var.app_port
  }

  # NAT がある前にタスクが起動すると、イメージや秘密を取りに行けずに失敗する。
  depends_on = [aws_nat_gateway.main, aws_route_table_association.private]

  lifecycle {
    # デプロイのワークフロー（Issue #167）が、新しいイメージのタスク定義に更新する。
    # terraform apply でそれを古いリビジョンへ戻さないよう、この項目は無視する。
    ignore_changes = [task_definition]

    precondition {
      condition     = var.ecs_desired_count >= var.ecs_min_count && var.ecs_desired_count <= var.ecs_max_count
      error_message = "ecs_desired_count は ecs_min_count と ecs_max_count の範囲内にしてください。"
    }

    precondition {
      condition     = var.ecs_max_count * (var.db_pool_size + var.db_max_overflow) <= var.rds_max_connections - var.rds_reserved_connections
      error_message = "ECS最大タスク数のDB接続上限が、RDSの予約接続を差し引いた接続予算を超えています。"
    }
  }
}
