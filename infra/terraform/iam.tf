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

# 画像の置き場は 2 つ（backend/app/storage.py の PUBLIC_PREFIX / PRIVATE_PREFIX）。
# - uploads/ … アバター。CloudFront（OAC）が配信する
# - private/ … レシピのサムネ・手順画像・感想画像。公開せず、署名付き URL で配信する
# アプリは**両方**を読み書き・削除する（Issue #185）。
resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.project_name}-ecs-task-s3"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${aws_s3_bucket.images.arn}/uploads/*",
          # private/ にも権限が要る。アップロード（PutObject）と削除ジョブ
          # （DeleteObject）に加え、**署名付き URL は署名者がその権限を持っていないと
          # 403 になる**ため GetObject も要る（Issue #185）。
          "${aws_s3_bucket.images.arn}/private/*",
        ]
      },
      {
        # 存在確認（HeadObject）自体に要るのは s3:GetObject で、ListBucket の有無は
        # **存在しないキーに 403 と 404 のどちらを返すか**に効く。404 を返せた方が
        # 「既に無いオブジェクトの削除」を成功扱いにする判定が素直になる。
        # 対象はアプリが使う 2 つの接頭辞に限る（バケット全体には広げない）。
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = aws_s3_bucket.images.arn
        Condition = { StringLike = { "s3:prefix" = ["uploads/*", "private/*"] } }
      },
    ]
  })
}
