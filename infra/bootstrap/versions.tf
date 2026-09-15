# バージョンは Issue #165 の Step 0（resolve-tech-stack）で確定した値。
# 本体（infra/terraform/versions.tf）とそろえる。
terraform {
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.64"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "Terraform"
      Component = "tfstate"
    }
  }
}

variable "aws_region" {
  type        = string
  description = "state 用バケットを作るリージョン（本体と同じにする）"
  default     = "ap-northeast-1"
}

variable "project_name" {
  type        = string
  description = "バケット名とタグに使うプロジェクト名"
  default     = "recipi"
}

output "tfstate_bucket" {
  description = "本体の backend.hcl の bucket に書く値"
  value       = aws_s3_bucket.tfstate.bucket
}

output "region" {
  description = "本体の backend.hcl の region に書く値"
  value       = var.aws_region
}
