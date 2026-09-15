# tfstate（Terraform の状態ファイル）を置く S3 バケットを作る。
#
# なぜ本体（infra/terraform）と分けるのか:
# - 本体は「S3 backend」で state をこのバケットに置く。バケットが無いと本体の
#   `terraform init` ができないので、先にこのディレクトリだけを 1 回 apply する。
# - このバケットは destroy しない（prevent_destroy）。本体を destroy しても、
#   state の履歴は残る。料金は中身が数 KB なので月 1 円未満。
# - このディレクトリ自身の state はローカル（terraform.tfstate。.gitignore 対象）。
#   中身はバケットの設定だけで、秘密は含まない。

# バケット名は世界で一意にする必要があるので、ランダムな接尾辞を付ける。
resource "random_id" "tfstate_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.project_name}-tfstate-${random_id.tfstate_suffix.hex}"

  # 誤って `terraform destroy` しても、state のバケットだけは消さない。
  lifecycle {
    prevent_destroy = true
  }
}

# 上書き・削除しても前の版に戻せるようにする（state を壊したときの保険）。
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

# 保存時の暗号化（S3 管理の鍵）。
resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# インターネットに公開される設定をすべて禁止する。
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# HTTPS 以外の通信を拒否する。
resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}
