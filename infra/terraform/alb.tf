# 内部ALB（API GatewayのVPC LinkからECSタスクへ負荷分散する）。
#
# クライアント ─HTTPS─> API Gateway ─ VPC Link ─> internal ALB ─> ECS(private):8000
#
# ALBはprivateサブネットに置き、インターネットから直接到達できないようにする。

resource "aws_lb" "api" {
  name               = "${var.project_name}-api"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for az in local.availability_zones : aws_subnet.private[az].id]

  tags = { Name = "${var.project_name}-api-alb" }
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-api"
  port        = var.app_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = "/healthz"
    protocol            = "HTTP"
    port                = "traffic-port"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.project_name}-api-targets" }
}

resource "aws_lb_listener" "api" {
  load_balancer_arn = aws_lb.api.arn
  port              = var.app_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
