# ECS 用の IAM ロール（2 種類）。
#
# - タスク実行ロール: ECS（エージェント）がタスクを起動するために使う。
#   イメージの取得（ECR）・ログの書き込み（CloudWatch Logs）・秘密の取得（Secrets Manager）。
# - タスクロール: コンテナの中のアプリ（boto3）が使う。画像バケットの読み書きだけ。
#   アプリにアクセスキーを渡さず、このロールの一時的な認証情報を使う（Issue #166）。

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- タスク実行ロール -------------------------------------------------------------
resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.project_name}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ECR からの pull と CloudWatch Logs への書き込み（AWS 管理のポリシー）。
resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# 読める秘密は、タスク定義で使う 3 つだけ（ARN を 1 つずつ列挙し、* にしない）。
resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${var.project_name}-ecs-task-execution-secrets"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.jwt_secret_key.arn,
        aws_secretsmanager_secret.log_hash_secret.arn,
      ]
    }]
  })
}

# --- タスクロール（アプリ用） -----------------------------------------------------
resource "aws_iam_role" "ecs_task" {
  name               = "${var.project_name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# 画像はすべて uploads/ 配下に置く（backend/app/storage.py の PUBLIC_PREFIX）。
resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.project_name}-ecs-task-s3"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.images.arn}/uploads/*"
      },
      {
        # 「既に無いオブジェクトの削除」を正しく判定するために、存在確認（HeadObject が
        # 404 を返せる）には ListBucket が要る。対象は uploads/ 配下に限る。
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = aws_s3_bucket.images.arn
        Condition = { StringLike = { "s3:prefix" = ["uploads/*"] } }
      },
    ]
  })
}
