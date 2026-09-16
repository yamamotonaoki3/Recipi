# 画像の配信（CloudFront ＋ OAC）。
#
#   画像 ─HTTPS─> CloudFront ─OAC（署名付きの読み取り）─> S3（uploads/*）
#
# OAC（Origin Access Control）: CloudFront が S3 に署名付きでアクセスする仕組み。
# バケットを公開せずに、CloudFront 経由でだけ画像を見せられる。
# アプリが返す画像 URL は `https://<このドメイン>/uploads/...`（ecs.tf の S3_PUBLIC_URL_BASE）。

resource "aws_cloudfront_origin_access_control" "images" {
  name                              = "${var.project_name}-images-oac"
  description                       = "OAC for the Recipi images bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "images" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.project_name} images"
  price_class     = "PriceClass_200" # 日本を含むアジアのエッジを使う（100 には含まれない）

  origin {
    domain_name              = aws_s3_bucket.images.bucket_regional_domain_name
    origin_id                = "s3-images"
    origin_access_control_id = aws_cloudfront_origin_access_control.images.id
  }

  # 画像は GET / HEAD だけ。キャッシュは AWS 管理のポリシー（CachingOptimized）。
  # uploads/ 以外のパスは、バケットポリシーで許していないので 403 になる。
  default_cache_behavior {
    target_origin_id       = "s3-images"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed: CachingOptimized
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # 独自ドメインは使わないので、既定の *.cloudfront.net の証明書を使う。
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "${var.project_name}-images" }
}
