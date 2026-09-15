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
  description = "2 つの AZ に作る private サブネット（ECS・RDS・VPC Link を置く）の CIDR"
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

variable "rds_allocated_storage" {
  type        = number
  description = "RDS のストレージ容量（GB）"
  default     = 20
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

variable "tags" {
  type        = map(string)
  description = "全リソースに追加するタグ"
  default     = {}
}
