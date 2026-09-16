# バージョンは Issue #165 の Step 0（resolve-tech-stack）で確定した値。
# - Terraform 1.15: ephemeral リソース（1.10+）と書き込み専用の引数（1.11+）を使うため。
#   これで DB のパスワードや鍵を tfstate に残さずに済む（secrets.tf）。
# - AWS provider 6 系: `password_wo` / `secret_string_wo`（書き込み専用の引数）を持つ。
# - random provider 3.9: `ephemeral "random_password"` を持つ（3.7+）。
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

  # state は S3 に置く。バケット名などは git 管理外の backend.hcl で渡す:
  #   terraform init -backend-config=backend.hcl
  # （書き方は backend.hcl.example。バケットは infra/bootstrap で作る）
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  # すべてのリソースに付けるタグ（コンソールで「Recipi のもの」と分かるように）。
  default_tags {
    tags = local.common_tags
  }
}
