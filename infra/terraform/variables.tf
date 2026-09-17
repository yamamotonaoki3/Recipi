variable "aws_region" {
  type        = string
  description = "リソースを作る AWS リージョン"
  default     = "ap-northeast-1"
}

variable "project_name" {
  type        = string
  description = "リソース名とタグに使うプロジェクト名"
  default     = "recipi"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name は半角小文字・数字・ハイフンだけで指定してください。"
  }
}

variable "vpc_cidr" {
  type        = string
  description = "VPC 全体の IPv4 CIDR"
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "2 つの AZ に作る public サブネット（NAT Gateway を置く）の CIDR"
  default     = ["10.20.0.0/24", "10.20.1.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2
    error_message = "public_subnet_cidrs には 2 つの CIDR を指定してください。"
  }
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "2 つの AZ に作る private サブネット（ALB・ECS・RDS・VPC Link を置く）の CIDR"
  default     = ["10.20.10.0/24", "10.20.11.0/24"]

  validation {
    condition     = length(var.private_subnet_cidrs) == 2
    error_message = "private_subnet_cidrs には 2 つの CIDR を指定してください。"
  }
}

variable "app_port" {
  type        = number
  description = "API コンテナ（uvicorn）が待ち受けるポート"
  default     = 8000
}

variable "rds_instance_class" {
  type        = string
  description = "RDS のインスタンスクラス"
  default     = "db.t4g.micro"
}

variable "rds_multi_az" {
  type        = bool
  description = "RDS を Multi-AZ（プライマリ＋別AZの待機系）で構成するか"
  default     = true
}

variable "rds_allocated_storage" {
  type        = number
  description = "RDS のストレージ容量（GB）"
  default     = 20
}

variable "rds_max_connections" {
  type        = number
  description = "RDS の max_connections（接続予算の検証に使う）"
  default     = 110

  validation {
    condition     = var.rds_max_connections > 0
    error_message = "rds_max_connections は 0 より大きくしてください。"
  }
}

variable "rds_reserved_connections" {
  type        = number
  description = "定期ジョブ・マイグレーション・管理接続のためにRDSへ残す接続数"
  default     = 30

  validation {
    condition     = var.rds_reserved_connections >= 0
    error_message = "rds_reserved_connections は 0 以上にしてください。"
  }
}

variable "ecs_task_cpu" {
  type        = number
  description = "ECS タスクの CPU ユニット（256 = 0.25 vCPU。Fargate の最小構成）"
  default     = 256
}

variable "ecs_task_memory" {
  type        = number
  description = "ECS タスクのメモリ（MiB）"
  default     = 512
}

variable "ecs_desired_count" {
  type        = number
  description = "ECS サービスで常に動かすタスクの数"
  default     = 1
}

variable "ecs_min_count" {
  type        = number
  description = "ECS Auto Scaling の最小タスク数"
  default     = 1

  validation {
    condition     = var.ecs_min_count >= 1
    error_message = "ecs_min_count は 1 以上にしてください。"
  }
}

variable "ecs_max_count" {
  type        = number
  description = "ECS Auto Scaling の最大タスク数"
  default     = 4

  validation {
    condition     = var.ecs_max_count >= 1
    error_message = "ecs_max_count は 1 以上にしてください。"
  }
}

variable "ecs_scale_cpu_target" {
  type        = number
  description = "ECS CPU使用率のスケール目標（%）"
  default     = 70

  validation {
    condition     = var.ecs_scale_cpu_target > 0 && var.ecs_scale_cpu_target < 100
    error_message = "ecs_scale_cpu_target は 0 より大きく 100 未満にしてください。"
  }
}

variable "ecs_scale_memory_target" {
  type        = number
  description = "ECS メモリ使用率のスケール目標（%）"
  default     = 70

  validation {
    condition     = var.ecs_scale_memory_target > 0 && var.ecs_scale_memory_target < 100
    error_message = "ecs_scale_memory_target は 0 より大きく 100 未満にしてください。"
  }
}

variable "db_pool_size" {
  type        = number
  description = "1 ECSタスクあたりのDB接続プール本数"
  default     = 10

  validation {
    condition     = var.db_pool_size >= 1
    error_message = "db_pool_size は 1 以上にしてください。"
  }
}

variable "db_max_overflow" {
  type        = number
  description = "1 ECSタスクあたりのDB接続プールの一時追加本数"
  default     = 10

  validation {
    condition     = var.db_max_overflow >= 0
    error_message = "db_max_overflow は 0 以上にしてください。"
  }
}

variable "backend_image_tag" {
  type        = string
  description = "ECR の backend イメージのタグ（初回は手動で push したタグ。以降はデプロイのワークフローが更新する）"
}

variable "cors_allow_origins" {
  type        = string
  description = "API の CORS で許可するオリジン（カンマ区切り）。本番は Web を配信しないので Tauri のオリジンだけ"
  default     = "tauri://localhost,http://tauri.localhost"
}

variable "api_throttle_rate_limit" {
  type        = number
  description = "API Gateway の 1 秒あたりの平均リクエスト数の上限"
  default     = 50
}

variable "api_throttle_burst_limit" {
  type        = number
  description = "API Gateway の瞬間的なリクエスト数の上限"
  default     = 100
}

variable "schedules_enabled" {
  type        = bool
  description = "定期ジョブ（EventBridge Scheduler）を動かすか（Issue #173）。インフラは立てたいが定期実行は止めたいときに false にする"
  default     = true
}

variable "alert_email" {
  type        = string
  description = "アラームの通知先メールアドレス（Issue #172）。実値は terraform.tfvars（git 管理外）にだけ書く。apply 後に届く確認メールのリンクを押すまで通知は来ない"

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.alert_email))
    error_message = "alert_email にはメールアドレスの形式で指定してください。"
  }
}

variable "tags" {
  type        = map(string)
  description = "全リソースに追加するタグ"
  default     = {}
}
