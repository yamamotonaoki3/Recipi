# セキュリティグループ（通信の許可リスト）。
#
# 通信の流れ:
#   API Gateway ─ VPC Link（vpclink SG）─ 8000 ─> ECS（ecs SG）─ 5432 ─> RDS（rds SG）
#
# ルールを SG の中に直接書かず、aws_vpc_security_group_*_rule に分けている理由:
# vpclink SG と ecs SG はお互いを参照し合う。SG の中に書くと「A を作るには B が要り、
# B を作るには A が要る」循環参照になり作れない。ルールを別リソースにすると解消できる。

resource "aws_security_group" "vpclink" {
  name        = "${var.project_name}-vpclink"
  description = "API Gateway VPC Link (to ECS only)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project_name}-vpclink" }
}

resource "aws_security_group" "ecs" {
  name        = "${var.project_name}-ecs"
  description = "ECS Fargate tasks (API)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project_name}-ecs" }
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "RDS PostgreSQL (from ECS only)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project_name}-rds" }
}

# --- VPC Link → ECS ------------------------------------------------------------
resource "aws_vpc_security_group_egress_rule" "vpclink_to_ecs" {
  security_group_id            = aws_security_group.vpclink.id
  referenced_security_group_id = aws_security_group.ecs.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  description                  = "to ECS app port"
}

resource "aws_vpc_security_group_ingress_rule" "ecs_from_vpclink" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.vpclink.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  description                  = "from API Gateway VPC Link"
}

# --- ECS → 外（HTTPS）と RDS ------------------------------------------------------
# HTTPS（443）は ECR・Secrets Manager・CloudWatch Logs・S3・外部 API へ出るため
# （NAT または S3 のゲートウェイ型エンドポイント経由）。
resource "aws_vpc_security_group_egress_rule" "ecs_https" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to AWS APIs and external APIs"
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_rds" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "to RDS PostgreSQL"
}

# DNS（Cloud Map・AWS の名前解決）は VPC 内の DNS（VPC CIDR の +2）へ出る。
resource "aws_vpc_security_group_egress_rule" "ecs_dns_udp" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  description       = "DNS in VPC"
}

resource "aws_vpc_security_group_egress_rule" "ecs_dns_tcp" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  description       = "DNS in VPC (TCP)"
}

# --- RDS ← ECS ------------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "from ECS tasks"
}
