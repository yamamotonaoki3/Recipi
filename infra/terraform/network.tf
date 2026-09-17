# ネットワーク（VPC・サブネット・NAT・ルート・S3 のゲートウェイ型エンドポイント）。
#
# 構成:
#   public  x2 … インターネットゲートウェイ（IGW）へ直接出られる。NAT Gateway を置く
#   private x2 … ALB・ECS・RDS・VPC Link を置く。外へ出るときは NAT Gateway を通る
# ECS に公開 IP は付けない。外からの入口は API Gateway（VPC Link 経由）だけ。

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  # privateサブネットの内部ALB・ECS・RDS間で名前解決できるようにする。
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project_name}-vpc" }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = each.value
  # public サブネットにも公開 IP を自動で付けない（ここに置くのは NAT だけ）。
  map_public_ip_on_launch = false

  tags = { Name = "${var.project_name}-public-${each.key}", Tier = "public" }
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = { Name = "${var.project_name}-private-${each.key}", Tier = "private" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}

# --- NAT Gateway（1 つだけ） ------------------------------------------------
# private の ECS が ECR（イメージ）・Secrets Manager・CloudWatch Logs・外部 API に
# 出るための出口。動いているだけで時間課金されるので、使わない期間は destroy する。
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[local.nat_availability_zone].id
  tags          = { Name = "${var.project_name}-nat" }

  # IGW ができてから作る（NAT は IGW 経由で外に出るため）。
  depends_on = [aws_internet_gateway.main]
}

# --- ルートテーブル -----------------------------------------------------------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project_name}-public-rt", Tier = "public" }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "${var.project_name}-private-rt", Tier = "private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# --- S3 のゲートウェイ型 VPC エンドポイント（無料） ----------------------------
# ECR のイメージの本体（レイヤー）は S3 に置かれている。このエンドポイントがあると、
# private サブネットから S3 への通信が NAT を通らなくなり、NAT の通信料がかからない。
# 画像バケットへの読み書きも同じくここを通る。
# 有料の Interface 型（ECR API・Logs・Secrets Manager 用）は作らない:
# 固定費が NAT より高く、外部の API（Anthropic 等）にも出られないため。
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "${var.project_name}-s3-gateway" }
}
