# infra/terraform

Recipi の本番環境（AWS・ap-northeast-1）を Terraform で作る。全体像は [`docs/requirements/architecture.md`](../../docs/requirements/architecture.md) §本番デプロイ。

**はじめて立てるときは、下の「はじめての apply（通し手順）」を上から順にたどる。** 途中の節は、その手順から参照される詳細。

> **学習用の運用**: 常時は動かさない。確認するときだけ apply し、終わったら `terraform destroy` する（NAT Gateway・RDS・ECS・VPC Link は動いているだけで時間課金される）。

## 構成

```text
クライアント ─HTTPS─> API Gateway HTTP API ─ VPC Link ─> 内部ALB ─> ECS Fargate(private):8000
画像        ─HTTPS─> CloudFront ─OAC─> S3(uploads/*)
VPC 2AZ: public x2（IGW・NAT 1 つ） / private x2（ALB・ECS・RDS Multi-AZ、0.0.0.0/0 → NAT、S3 はゲートウェイ型エンドポイント）
```

| ファイル | 中身 |
| --- | --- |
| `network.tf` | VPC・サブネット・NAT 1 つ・ルート・S3 のゲートウェイ型エンドポイント |
| `security-groups.tf` | VPC Link → ALB（8000）、ALB → ECS（8000）、ECS → RDS（5432） |
| `apigateway.tf` / `alb.tf` | HTTP API・VPC Link・内部ALB・ターゲットグループ |
| `ecs.tf` / `ecs-autoscaling.tf` / `iam.tf` / `ecr.tf` | Fargate のクラスタ・タスク定義・サービス、自動スケール、ロール、イメージの置き場 |
| `rds.tf` / `secrets.tf` | PostgreSQL 18、秘密（Secrets Manager） |
| `s3-images.tf` / `cloudfront.tf` | 非公開の画像バケットと、その配信 |
| `github-oidc.tf` | GitHub Actions のデプロイ用ロール（Issue #167） |

### 1,000ユーザー規模の性能設計

登録ユーザー1,000人、ピーク同時利用100人を基準にする。ECSは通常1タスク、CPUまたはメモリが高くなった場合に最大4タスクへ自動拡張する。各タスクのDB接続上限は20本で、最大4タスクでも80本に収め、RDSの約110接続のうち30本を定期ジョブ・マイグレーション・管理接続用に残す。RDS は Multi-AZ の待機系を持ち、障害時は同じエンドポイントのまま自動フェイルオーバーする。`terraform plan` 時にこの接続予算を超える設定を拒否する。

ローカルで複数タスク相当を確認するときは、`infra/docker-compose.perf.yml` を重ねてAPIを4コンテナ起動し、HAProxyの8000番ポートへk6を向ける。これはECS Auto Scalingそのものではなく、複数タスク時の負荷分散とDB接続予算を確認するための検証用構成である。

## 秘密情報の扱い

- パスワードと鍵は Terraform が `ephemeral "random_password"` で作り、書き込み専用の引数（`password_wo` / `secret_string_wo`）で RDS と Secrets Manager に渡す。**tfstate にも plan にも値は残らない**。
- 値を作り直すときは、`secrets.tf` の `*_version` を 1 つ上げて apply する（DB は RDS と `DATABASE_URL` の版を同時に上げる）。
- `terraform.tfvars`・`backend.hcl`・`*.tfstate*`・`*.tfplan`・`.terraform/` はコミットしない（`.gitignore` 済み）。plan の出力もログや CI に貼らない。
- AWS の認証情報はコードや tfvars に書かず、AWS CLI のプロファイルから使う。plan / apply に使う IAM ユーザーには、ここで作るリソース（VPC・ECS・ALB・RDS・S3・CloudFront・API Gateway・Secrets Manager・IAM・ECR・CloudWatch Logs）を操作する権限と、state 用バケットの読み書き権限が要る。

## はじめての apply（通し手順）

> **先にリージョンをそろえる**。この手順の `aws` コマンドはすべて **ap-northeast-1**（東京）を前提にしている。AWS CLI のプロファイルの既定リージョンが違う（または設定されていない）と、別のリージョンを見に行って「クラスタが無い」等で失敗する。ターミナルで一度だけ次を実行しておく。
>
> ```bash
> export AWS_DEFAULT_REGION=ap-northeast-1   # PowerShell: $env:AWS_DEFAULT_REGION = "ap-northeast-1"
> ```

**順番が重要**。ECS のタスク定義は `backend_image_tag` の ECR イメージを参照するため、**イメージが無い状態で本体を apply すると、サービスがタスクを起動できない**（`CannotPullContainerError` が続き、マイグレーションもできない）。そこで **ECR とイメージを先に用意する**。

### 1. state 用バケットを作る（最初の 1 回だけ。destroy しない）

料金は月 1 円未満。ここだけ state はローカルに持つ（秘密は入らない）。

```bash
cd infra/bootstrap
terraform init
terraform apply
terraform output -raw tfstate_bucket   # → 次の backend.hcl に書く
```

### 2. 本体の backend を設定して init

```bash
cd ../terraform
cp backend.hcl.example backend.hcl     # bucket に 1 の出力を書く
terraform init -backend-config=backend.hcl
```

### 3. `terraform.tfvars` を書く（git 管理外）

```bash
cp terraform.tfvars.example terraform.tfvars
```

- `alert_email` … アラームの通知先メールアドレス
- `backend_image_tag` … この時点では仮の値（プレースホルダ）を書く。実際に使うタグは、次の手順でイメージを push した後に書き換える。

### 4. ECR リポジトリだけを先に作る

```bash
terraform apply -target=aws_ecr_repository.backend
```

- `-target` は本来は非推奨（依存関係の一部だけを適用するため）。ここでは「イメージが無い状態で本体を apply すると、ECS のタスクが `CannotPullContainerError` で起動できないが、イメージの置き場は Terraform が作る」という鶏と卵を解くためだけに使う。
- **2 回目以降の apply では不要**。以降は `terraform apply` だけでよい。

### 5. イメージをビルドして push する

```bash
ECR_URL=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region ap-northeast-1 \
  | docker login --username AWS --password-stdin "${ECR_URL%%/*}"
TAG=$(git rev-parse HEAD)               # コミットのフル SHA
docker build -t "$ECR_URL:$TAG" ../../backend
docker push "$ECR_URL:$TAG"
echo "$TAG"                             # → terraform.tfvars の backend_image_tag に書く
```

`git rev-parse HEAD` で表示されたタグを、`terraform.tfvars` の `backend_image_tag` に書き換える。

### 6. 本体を apply する

```bash
terraform fmt -check
terraform validate
terraform plan -out=plan.tfplan
terraform apply plan.tfplan
```

### 7. マイグレーションを 1 回流す（初回だけ手動）

DB が空の状態なので、テーブルを作る。以降は `deploy-backend` ワークフローが毎回行う。

```bash
aws ecs run-task --cluster "$(terraform output -raw ecs_cluster_name)" \
  --task-definition "$(terraform output -raw ecs_task_definition_family)" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw ecs_security_group_id)],assignPublicIp=DISABLED}" \
  --overrides "$(jq -nc --arg name "$(terraform output -raw ecs_container_name)" \
    '{containerOverrides:[{name:$name,command:["alembic","upgrade","head"]}]}')"
```

終了コードが 0 になったことを確認してから次へ進む（[ジョブのログの探し方](#ジョブのログの探し方)と同じ方法で確認できる）。

### 8. SNS の確認メールのリンクを押す

apply の後、AWS から確認メール（Subject: `AWS Notification - Subscription Confirmation`）が届く。**押すまでアラームの通知は来ない**（→ [監視](#監視issue-172)）。

### 9. GitHub の Secrets を 4 つ登録する

以降の backend の更新は `deploy-backend` ワークフロー（手動実行）で行う（→ [デプロイ](#デプロイissue-167)）。

### 10. 動作を確認する

`/healthz`・`/healthz/db` が 200 になること、画像が CloudFront 経由で見えることなどを確認する。

```bash
curl -i "$(terraform output -raw api_url)/healthz"
```

### 11. 終わったら destroy する

```bash
aws s3 rm "s3://$(terraform output -raw images_bucket)" --recursive   # バケットを空にする
terraform destroy
```

state 用バケット（1 で作ったもの）は残す。次に立てるときは 2 から始められる（4・5 の ECR 作成とイメージ push は、ECR も destroy されているので再度必要）。

## デプロイ（Issue #167）

`terraform apply` でインフラを作った後、backend の更新は GitHub Actions の `deploy-backend` ワークフロー（手動実行）で行う。イメージの push → タスク定義の更新 → マイグレーション → サービス更新 → `/healthz`・`/healthz/db` の確認までを 1 回で行い、失敗したら前のタスク定義に戻す。main への push での自動デプロイはしない。

### GitHub の Secrets（通し手順の 9）

リポジトリの Settings → Secrets and variables → Actions で、次の 4 つを登録する。

| Secret | 入れる値（`terraform output`） | 形式 |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_deploy_role_arn` | `arn:aws:iam::...:role/recipi-github-deploy` |
| `AWS_API_BASE_URL` | `terraform output -raw api_url` | `https://...`（末尾のスラッシュなし） |
| `AWS_ECS_SUBNET_IDS` | `terraform output -json private_subnet_ids` の 2 件 | カンマ区切り（`subnet-aaa,subnet-bbb`。空白を入れない） |
| `AWS_ECS_SECURITY_GROUP_ID` | `terraform output -raw ecs_security_group_id` | `sg-...` |

## 監視（Issue #172）

CloudWatch でログを集め、異常があれば SNS からメールで知らせる。

### 準備（apply のとき 1 回だけ。通し手順の 3・8）

1. `terraform.tfvars` の `alert_email` に通知先のメールアドレスを書く（このファイルは git 管理外）。
2. `terraform apply` の後、AWS から **確認メール（Subject: AWS Notification - Subscription Confirmation）** が届く。**そのリンクを押すまで通知は来ない**。
3. 押したかどうかは次で確認できる（`SubscriptionArn` が `PendingConfirmation` でなければ確認済み）。

   ```bash
   aws sns list-subscriptions-by-topic --topic-arn "$(terraform output -raw alerts_topic_arn)"
   ```

### 何を監視しているか

| アラーム | 何を見ているか | データが来ないとき |
| --- | --- | --- |
| 5xx の急増 | アクセスログの `status >= 500` が 5 分で 5 件以上 | 正常扱い（アクセスが無い時間帯に鳴らせない） |
| ログイン失敗の急増 | 監査ログの `auth.login` の失敗が 5 分で 20 件以上 | 正常扱い |
| トークン再利用 | 監査ログの `token_reuse_detected` が 1 件以上 | 正常扱い |
| パスワード再設定のレート制限 | 監査ログの `rate_limited_*` が 15 分で 10 件以上 | 正常扱い |
| 想定外の例外 | ログの `message` が `unhandled exception` | 正常扱い |
| ECS サービスが動いていない | ECS の `CPUUtilization` が**届かないこと**（タスクが動いていれば必ず出る値） | **異常扱い**（destroy 中も鳴る） |
| API Gateway の 5xx | HTTP API の `5xx` が 5 分で 5 件以上 | 正常扱い |
| RDS の CPU | 80% 以上が 15 分続く | 無視 |
| RDS の空き容量 | 2GB（2147483648 バイト）未満、または**届かないこと** | **異常扱い** |

- **Container Insights は有効にしていない**（観測データごとの課金が増えるため）。そのため「タスク数そのもの」は監視せず、上のように標準メトリクスで代用している。
- `destroy` している間は、`breaching`（データなし＝異常）のアラームが鳴る。アラーム自体も Terraform の管理下なので、destroy すれば消える。

### 調査のしかた

`aws logs start-query` でも使えるが、CloudWatch のコンソール（Logs Insights）に保存済みのクエリが 3 本入っている。

- 「ログイン失敗をアドレスごとに数える」
- 「request_id で 1 リクエストを追う」（`REPLACE_WITH_X_REQUEST_ID` を実際の値に置き換える）
- 「遅いエンドポイントを探す」

**API Gateway のログとアプリのログの突き合わせ方**: API Gateway のアクセスログ（`/aws/apigateway/recipi-api`）の `requestId` は API Gateway が振る値で、アプリのログの `request_id`（`X-Request-ID`）とは**別物**。両方を見たいときは、時刻（`requestTime` と `time`）・パス（`routeKey` と `path`）・クライアント IP（`ip` と `client_ip`）で突き合わせる。アプリの中だけを追うなら `request_id` だけで足りる。

### ログの量と料金の目安

| 種類 | 1 件あたり | 想定件数（1 日） | 月あたり |
| --- | --- | --- | --- |
| アプリのアクセスログ | 約 0.35KB | 1 万 | 約 105MB |
| 監査ログ | 約 0.3KB | 500 | 約 4.5MB |
| アプリのその他のログ | 約 0.4KB | 100 | 約 1.2MB |
| API Gateway のアクセスログ | 約 0.4KB | 1 万 | 約 120MB |
| ヘルスチェック | — | — | 0（本番は `LOG_LEVEL=INFO` で、`/healthz` のアクセスログは DEBUG なので出ない） |

合計で月約 230MB。東京の料金は取り込み 1GB あたり約 0.76 ドル、保存 1GB あたり月約 0.033 ドルなので、365 日ためても数 GB で**月あたり数十円**の見込み。アラーム（10 個以下）と SNS のメールは無料枠の範囲。

**月 5GB を超えるようになったら**、監査ログを別のロググループに分けて、アプリログの保存期間を短くする。実際の取り込み量は次で確認できる。

```bash
aws cloudwatch get-metric-statistics --namespace AWS/Logs --metric-name IncomingBytes \
  --dimensions Name=LogGroupName,Value="$(terraform output -raw api_log_group)" \
  --start-time "$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 86400 --statistics Sum
```

### メトリクスフィルタの検証

アラームの元になるメトリクスフィルタは、パターンが実際のログと合っていないと**永久に鳴らない**。`terraform validate` では気づけないので、サンプルのログ行で確かめるスクリプトを用意している（`aws logs test-metric-filter` を使う。読み取りのみ・無料）。

```bash
bash infra/scripts/test-metric-filters.sh
```

## 定期ジョブ（Issue #173）

EventBridge Scheduler が、決まった時刻に ECS のタスクとして管理コマンドを 1 回だけ動かす（API と同じイメージ・同じタスク定義で、`command` だけを差し替える）。常駐のワーカーは置かない。

| スケジュール | コマンド | 頻度（日本時間） |
| --- | --- | --- |
| `recipi-notification-sweep` | `python -m app.jobs.notification_sweep` | 10 分ごと |
| `recipi-storage-deletion` | `python -m app.jobs.storage_deletion` | 15 分ごと |
| `recipi-gc-uploads` | `python -m app.jobs.gc_uploads` | 1 時間ごと |
| `recipi-cleanup-refresh-tokens` | `python -m app.jobs.cleanup_refresh_tokens` | 毎日 2:10 |
| `recipi-cleanup-notifications` | `python -m app.jobs.cleanup_notifications` | 毎日 2:20 |
| `recipi-cleanup-password-reset-attempts` | `python -m app.jobs.cleanup_password_reset_attempts` | 毎日 2:30 |
| `recipi-trim-recipe-views` | `python -m app.jobs.trim_recipe_views` | 毎日 2:40 |
| `recipi-recount-counts` | `python -m app.jobs.recount_counts` | 毎日 2:50 |

- **多重起動について**: 各ジョブは `FOR UPDATE SKIP LOCKED` やユーザー単位の advisory lock で、同時に 2 本走っても壊れない（Issue #72・#85）。そのためスケジューラ側で排他はしない。1 回の実行はいずれも数十秒以内の想定で、間隔より十分短い。**データが増えて実行時間が間隔に近づいてきたら、頻度を下げる**。
- **止めたいとき**: `terraform.tfvars` に `schedules_enabled = false` を書いて apply すると、8 本とも `DISABLED` になる（インフラは残したまま定期実行だけ止める）。
- 状態の確認:

  ```bash
  aws scheduler list-schedules --group-name "$(terraform output -raw scheduler_group_name)" \
    --query 'Schedules[].[Name,State]' --output table
  ```

### ジョブを手動で 1 回だけ動かす

デモ中に日次ジョブを見せたいときなどに使う。

```bash
cd infra/terraform
aws ecs run-task \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --task-definition "$(terraform output -raw ecs_task_definition_family)" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -json private_subnet_ids | jq -r 'join(",")')],securityGroups=[$(terraform output -raw ecs_security_group_id)],assignPublicIp=DISABLED}" \
  --overrides "$(jq -nc --arg name "$(terraform output -raw ecs_container_name)" \
    '{containerOverrides:[{name:$name,command:["python","-m","app.jobs.recount_counts"]}]}')"
```

### ジョブのログの探し方

ジョブのログは API と同じロググループ（`/ecs/recipi-api`）に入る。ログストリーム名では区別できないので、ロガー名で絞る。

```text
fields @timestamp, level, logger, message
| filter logger like /app\.jobs/
| sort @timestamp desc
```

### ジョブの失敗はどう気づくか

4 通りの経路で拾い、すべて同じ SNS（メール）に通知する。

| 経路 | 何を見ているか |
| --- | --- |
| (a) ジョブの異常終了 | ECS のイベントで、**定期ジョブのタスク**の終了コードが 0 以外 |
| (b) ジョブの起動失敗 | ECS のイベントで、**定期ジョブのタスク**が `stopCode = TaskFailedToStart`（イメージや秘密を取得できなかった等） |
| (c) スケジューラが起動できなかった | Scheduler（`AWS/Scheduler`）の **`TargetErrorCount`**（ディメンション `ScheduleGroup = recipi-jobs`）。IAM エラー・スロットリング等で `RunTask` を呼べなかった場合。ECS のイベントは出ない |
| (d) 終了コード 0 のまま失敗を積み残した | ログの件数（`storage_deletion` の警告が 1 時間で 10 件以上、`notification_sweep` のエラーが 5 件以上） |

- (d) があるのは、これらのジョブが「個別の失敗を記録して次回に回す」作りで、プロセス自体は正常終了するため。
- **ジョブと API のタスクは、専用のタグで見分けている**。スケジューラは起動するタスクに `recipi:job = <ジョブ名>`、API のサービスはタスク定義のタグ `recipi:component = api` をタスクへ伝える（`propagate_tags`）。こうしないと、**通常のデプロイで古い API のタスクが止まるたびに「ジョブが失敗しました」と通知**されてしまう。
  - なお、イベントパターンの配列は「どれかが一致すれば真」なので、「`Project` はあるが `recipi:job` は無い」という AND の条件は書けない。**判別用のタグを 1 つずつ用意する**のが確実。
- **API のタスク**については、「起動すらできなかった」ときだけ別のルールで通知する（デプロイの失敗を意味するため）。終了コードが 0 以外での停止は、デプロイや再起動でも起きるので通知しない。API の異常は #172 の 5xx・ECS のメトリクス・ヘルスチェックで気づく仕組みになっている。

### 費用について

- **Scheduler・EventBridge のルール・アラームは、現時点の無料枠の範囲**（Scheduler は月 1,400 万回、アラーム 10 個、SNS のメール 1,000 通まで）。料金は改定されうるので目安として扱い、実際は AWS の請求画面（Billing）や Pricing Calculator で確認する。
- **課金されるのは、起動される ECS タスクの分**。1 日およそ 269 回（10 分ごと 144 ＋ 15 分ごと 96 ＋ 1 時間ごと 24 ＋ 日次 5）。1 回あたり最低課金 1 分・0.25vCPU / 0.5GB で約 0.03 円なので、**1 日およそ 10〜20 円、1 か月動かし続けて 300〜600 円**の見込み。イメージの取得は S3 のゲートウェイ型エンドポイントを通るので、NAT の通信料はほとんどかからない。
- 学習用では**インフラを立てている時間だけ**かかる。止めるときは `schedules_enabled = false` か `terraform destroy`。

### タスク定義を API と共用していること

ジョブは API と同じタスク定義（ファミリー名を指定＝常に最新のリビジョン）を使う。そのため **#167 でデプロイしてイメージが変わると、ジョブも新しいイメージで動く**。デプロイ後は、日次ジョブを 1 本手動で動かして終了コード 0 になることを確かめる。将来、ジョブと API で必要な依存が食い違ってきたら、ジョブ専用のタスク定義に分ける。

## デプロイの手動確認・復旧

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

- **使うときだけ apply し、終わったら `terraform destroy` する**（通し手順の 11）。NAT Gateway・RDS（Multi-AZ の待機系を含む）・ECS・API Gateway の VPC Link などは、動いているだけで時間課金される。
- 内部ALBは学習用の負荷分散・ヘルスチェックのために使用する。入口は API Gateway HTTP API ＋ VPC Link ＋ 内部ALB。検証しない期間は `terraform destroy` でALBの固定費も止める。
- Container Insights は有効にしない（観測データごとの課金を避けるため）。
- RDS は `skip_final_snapshot = true`・`deletion_protection = false`。destroy するとデータは消える（長く使う本番なら逆にする）。
- 画像バケットは `force_destroy` を付けていない。destroy の前に中身を空にする（`aws s3 rm s3://<images_bucket> --recursive`）。
- NAT は 1 つ（1 つ目の AZ）。その AZ が止まると、ECS は外に出られない。
