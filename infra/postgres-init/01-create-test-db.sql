-- postgres コンテナの初回起動時に 1 回だけ実行される（/docker-entrypoint-initdb.d/）。
-- テスト用のデータベースを開発用と同じインスタンス内に作る。
-- （テストは APP_ENV=test で .env.test の DATABASE_URL を使い、この DB を指す）
SELECT 'CREATE DATABASE recipi_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'recipi_test')\gexec
