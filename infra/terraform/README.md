# infra/terraform

Recipi の本番環境（AWS）を Terraform で作る。詳しい運用手順（初回のイメージの push、デプロイ、費用の目安、監視）は Issue #168 で追記する。

## 構成

```text
クライアント ─HTTPS─> API Gateway HTTP API ─ VPC Link ─> Cloud Map(SRV) ─> ECS Fargate(private):8000
画像        ─HTTPS─> CloudFront ─OAC─> S3(uploads/*)
VPC 2AZ: public x2（IGW・NAT 1 つ） / private x2（ECS・RDS、0.0.0.0/0 → NAT、S3 はゲートウェイ型エンドポイント）
```

| ファイル | 中身 |
| --- | --- |
| `network.tf` | VPC・サブネット・NAT 1 つ・ルート・S3 のゲートウェイ型エンドポイント |
| `security-groups.tf` | VPC Link → ECS（8000）、ECS → RDS（5432） |
| `apigateway.tf` / `service-discovery.tf` | HTTP API・VPC Link・Cloud Map（SRV） |
| `ecs.tf` / `iam.tf` / `ecr.tf` | Fargate のクラスタ・タスク定義・サービス、ロール、イメージの置き場 |
| `rds.tf` / `secrets.tf` | PostgreSQL 18、秘密（Secrets Manager） |
| `s3-images.tf` / `cloudfront.tf` | 非公開の画像バケットと、その配信 |
| `github-oidc.tf` | GitHub Actions のデプロイ用ロール（Issue #167） |

## 秘密情報の扱い

- パスワードと鍵は Terraform が `ephemeral "random_password"` で作り、書き込み専用の引数（`password_wo` / `secret_string_wo`）で RDS と Secrets Manager に渡す。**tfstate にも plan にも値は残らない**。
- 値を作り直すときは、`secrets.tf` の `*_version` を 1 つ上げて apply する（DB は RDS と `DATABASE_URL` の版を同時に上げる）。
- `terraform.tfvars`・`backend.hcl`・`*.tfstate*`・`*.tfplan`・`.terraform/` はコミットしない（`.gitignore` 済み）。plan の出力もログや CI に貼らない。
- AWS の認証情報はコードや tfvars に書かず、AWS CLI のプロファイルから使う。plan / apply に使う IAM ユーザーには、ここで作るリソース（VPC・ECS・RDS・S3・CloudFront・API Gateway・Cloud Map・Secrets Manager・IAM・ECR・CloudWatch Logs）を操作する権限と、state 用バケットの読み書き権限が要る。

## 手順（最小限）

```bash
# 1. state 用バケット（最初の 1 回だけ。料金は月 1 円未満。destroy しない）
cd infra/bootstrap
terraform init
terraform apply
terraform output -raw tfstate_bucket   # → backend.hcl の bucket に書く

# 2. 本体
cd ../terraform
cp backend.hcl.example backend.hcl          # bucket を書き換える
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform fmt -check
terraform validate
terraform plan -out=plan.tfplan
terraform apply plan.tfplan
```

## デプロイ（Issue #167）

`terraform apply` でインフラを作った後、backend の更新は GitHub Actions の `deploy-backend` ワークフロー（手動実行）で行う。イメージの push → マイグレーション → サービス更新 → `/healthz` の確認までを 1 回で行い、失敗したら前のタスク定義に戻す。

### 初回だけ必要な準備

1. **イメージを 1 つ push する**（`terraform apply` の前に。ECR は apply で作られるので、リポジトリだけ先に作るか、apply 後にタスクが起動しない状態から始めてもよい）:

   ```bash
   aws ecr get-login-password --region ap-northeast-1 \
     | docker login --username AWS --password-stdin "$(terraform output -raw ecr_repository_url | cut -d/ -f1)"
   TAG=$(git rev-parse HEAD)
   docker build -t "$(terraform output -raw ecr_repository_url):$TAG" backend
   docker push "$(terraform output -raw ecr_repository_url):$TAG"
   # この $TAG を terraform.tfvars の backend_image_tag に書いて apply する
   ```

2. **マイグレーションを 1 回流す**（初回は DB が空のため）:

   ```bash
   aws ecs run-task --cluster "$(terraform output -raw ecs_cluster_name)" \
     --task-definition "$(terraform output -raw ecs_task_definition_family)" \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw ecs_security_group_id)],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"api","command":["alembic","upgrade","head"]}]}'
   ```

3. **GitHub の Secrets に 4 つ登録する**（リポジトリの Settings → Secrets and variables → Actions）:

   | Secret | 入れる値（`terraform output`） | 形式 |
   | --- | --- | --- |
   | `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_deploy_role_arn` | `arn:aws:iam::...:role/recipi-github-deploy` |
   | `AWS_API_BASE_URL` | `terraform output -raw api_url` | `https://...`（末尾のスラッシュなし） |
   | `AWS_ECS_SUBNET_IDS` | `terraform output -json private_subnet_ids` の 2 件 | カンマ区切り（`subnet-aaa,subnet-bbb`。空白を入れない） |
   | `AWS_ECS_SECURITY_GROUP_ID` | `terraform output -raw ecs_security_group_id` | `sg-...` |

### デプロイの手動確認・復旧

ワークフローをキャンセルしたり、ランナーが強制終了したりすると、ロールバックのステップが動かないことがある。次の点に注意する。

- ECS の**サーキットブレーカー**は、「新しいタスクが安定して起動できないデプロイ」を自動で前のタスク定義へ戻す。
- ただし、**サービスが安定した後にヘルスチェックだけが失敗した場合**（アプリは起動するが `/healthz/db` が 500 など）は自動で戻らない。ワークフローが中断されていると、新しいリビジョンのまま残る。

そのときは、状態を確認して手動で戻す。

```bash
# 現在のリビジョン・展開の状態を見る
aws ecs describe-services --cluster recipi-cluster --services recipi-api \
  --query 'services[0].deployments[?status==`PRIMARY`].[taskDefinition,runningCount,rolloutState,rolloutStateReason]'

# 前のリビジョンに戻す（<n> は戻したいリビジョン番号）
aws ecs update-service --cluster recipi-cluster --service recipi-api \
  --task-definition recipi-api:<n>
aws ecs wait services-stable --cluster recipi-cluster --services recipi-api
```

## 学習用の運用とトレードオフ

- **使うときだけ apply し、終わったら `terraform destroy` する**。NAT Gateway・RDS・ECS・API Gateway の VPC Link などは、動いているだけで時間課金される。
- RDS は `skip_final_snapshot = true`・`deletion_protection = false`。destroy するとデータは消える（長く使う本番なら逆にする）。
- 画像バケットは `force_destroy` を付けていない。destroy の前に中身を空にする（`aws s3 rm s3://<images_bucket> --recursive`）。
- NAT は 1 つ（1 つ目の AZ）。その AZ が止まると、ECS は外に出られない。
