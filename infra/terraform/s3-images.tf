# 画像の保存先（非公開の S3 バケット）。
#
# - バケットは完全に非公開。表示は CloudFront（cloudfront.tf）経由だけにする。
#   S3 の URL に直接アクセスすると 403 になる。
# - CloudFront（OAC）に許すのは `uploads/*` の読み取り（GetObject）だけ。
# - アプリ（ECS タスクロール）は読み書き・削除できる（iam.tf）。
# - force_destroy は付けない: 中身はユーザーがアップロードした画像。destroy で
#   まとめて消えないようにする。消すときはバケットを空にしてから destroy する（README）。

resource "random_id" "images_bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "images" {
  bucket = "${var.project_name}-images-${random_id.images_bucket_suffix.hex}"
  tags   = { Name = "${var.project_name}-images" }
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "images" {
  bucket = aws_s3_bucket.images.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.images.arn, "${aws_s3_bucket.images.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        # このディストリビューション（AWS:SourceArn で限定）の OAC だけに、
        # uploads/ 配下の読み取りを許す。他の CloudFront や直接のアクセスは不可。
        Sid       = "AllowCloudFrontReadUploads"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.images.arn}/uploads/*"
        Condition = {
          StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.images.arn }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.images]
}
