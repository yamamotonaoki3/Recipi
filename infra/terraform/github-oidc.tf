# GitHub Actions から AWS を操作するための OIDC 連携（Issue #167 のデプロイで使う）。
#
# アクセスキーを GitHub に置かず、ワークフローの実行ごとに発行される短命のトークンで
# このロールを引き受ける。引き受けられるのは、このリポジトリの main ブランチからの実行だけ。

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # thumbprint_list は省略（AWS が GitHub の証明書を自動で検証するため、現在は不要）。
}

resource "aws_iam_role" "github_deploy" {
  name = "${var.project_name}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # main ブランチからの実行だけ（他ブランチ・他リポジトリ・PR からは引き受けられない）。
          "token.actions.githubusercontent.com:sub" = "repo:yamamotonaoki3/Recipi:ref:refs/heads/main"
        }
      }
    }]
  })
}

locals {
  # account_id は locals.tf で定義している（ここでは参照するだけ）。
  task_definition_arn_base = "arn:aws:ecs:${var.aws_region}:${local.account_id}:task-definition/${aws_ecs_task_definition.api.family}"
}

# デプロイ（Issue #167）に必要な権限だけを付ける:
# イメージの push、タスク定義の登録、マイグレーション用タスクの起動と確認、サービスの更新。
resource "aws_iam_role_policy" "github_deploy" {
  name = "${var.project_name}-github-deploy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*" # この操作はリソースを指定できない
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:DescribeImages",
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.backend.arn
      },
      {
        Sid      = "TaskDefinition"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
        Resource = "*" # この 2 つはリソースを指定できない
      },
      {
        Sid      = "RunMigrationTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "${local.task_definition_arn_base}:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Sid      = "DescribeTasks"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks"]
        Resource = "arn:aws:ecs:${var.aws_region}:${local.account_id}:task/${aws_ecs_cluster.main.name}/*"
      },
      {
        Sid      = "UpdateService"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = aws_ecs_service.api.id
      },
      {
        # タスク定義に書いた 2 つのロールを ECS に渡す権限（ECS 以外には渡せない）。
        Sid      = "PassEcsRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.ecs_task_execution.arn, aws_iam_role.ecs_task.arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      # CloudWatch Logs を読む権限は付けない（Issue #167）。デプロイのワークフローは
      # ログ本文を出さず（秘密が混ざる可能性があるため）、失敗時はロググループ名と
      # ログストリーム名だけを案内する。中身は人が AWS のコンソールで見る。
    ]
  })
}
