# Recipi バックエンドの本番向けイメージ。
# タグは固定する（python:3.14.7-slim。tech-stack.md）。
# 「マルチステージビルド」= ビルド用と実行用でステージを分け、実行イメージを小さくする。

# ---- ステージ 1: 依存をインストール --------------------------------------
FROM python:3.14.7-slim AS builder

WORKDIR /app

# まず requirements だけコピーして pip install する。
# こうするとソースだけ変えた再ビルドで pip キャッシュが効く。
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- ステージ 2: 実行イメージ ------------------------------------------
FROM python:3.14.7-slim AS runtime

# root ではなく専用ユーザーで動かす（セキュリティ上の基本）。
RUN useradd --create-home --uid 1000 appuser
WORKDIR /app

# ステージ 1 で入れた依存だけを持ってくる（pip 本体やキャッシュは持ち込まない）。
COPY --from=builder /install /usr/local

# アプリ本体。
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./

USER appuser

EXPOSE 8000
# 本番の worker 数・プロセス構成は未定（todo #40）。ここでは単一プロセス。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
