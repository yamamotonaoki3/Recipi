# RDS for PostgreSQL（private サブネット・シングル AZ）。
#
# - バージョンは要件定義書（docs/requirements/tech-stack.md）の PostgreSQL 18 に合わせる
#   （ローカルの docker compose と同じメジャー）。マイナーは AWS が選ぶ。
# - パスワードは書き込み専用の `password_wo` で渡し、tfstate に残さない（secrets.tf）。
# - `skip_final_snapshot = true`・`deletion_protection = false` は、学習用で
#   「使い終わるたびに destroy する」運用に合わせたもの。destroy するとデータは消える。
#   本番で長く使うなら、どちらも逆にする（README に記載）。

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = [for az in local.availability_zones : aws_subnet.private[az].id]
  tags       = { Name = "${var.project_name}-db-subnet-group" }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "18"

  instance_class    = var.rds_instance_class
  allocated_storage = var.rds_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = local.database_name
  username = local.database_username

  # 書き込み専用の引数: RDS には渡すが、tfstate・plan には値が残らない。
  # 値を変えたい（作り直したい）ときは password_wo_version を 1 つ上げて apply する
  # （secrets.tf の DATABASE_URL の版も同時に上げること）。
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = local.db_password_version

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false

  tags = { Name = "${var.project_name}-db" }
}
