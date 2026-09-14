-- README 用デモ環境の専用 DB。postgres コンテナの初回起動時に 1 回だけ作る。
-- 開発用 DB とは分離し、seed は APP_ENV=demo かつ DB 名に demo を含む場合だけ動く。
SELECT 'CREATE DATABASE recipi_demo'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'recipi_demo')\gexec
