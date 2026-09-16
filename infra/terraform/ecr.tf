# backend のコンテナイメージを置く ECR リポジトリ。
#
# - IMMUTABLE: 同じタグで上書きできない（「どのコミットのイメージか」がタグで一意に決まる）。
# - force_delete = true: destroy を 1 回で終わらせるため（中にイメージがあっても消す）。
#   イメージは backend のソースからいつでも作り直せるので、消えても困らない。

resource "aws_ecr_repository" "backend" {
  name                 = "${var.project_name}-backend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${var.project_name}-backend" }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "直近 10 世代だけ残す"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
