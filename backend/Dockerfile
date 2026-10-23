# Recipi バックエンドの本番向けイメージ。
# タグは固定する（python:3.14.9-slim。tech-stack.md）。
# 「マルチステージビルド」= ビルド用と実行用でステージを分け、実行イメージを小さくする。

# Debianは修正をバックポートするため、ssl.OPENSSL_VERSIONだけでは判定しない。
# DSA-6531-1の修正版（3.5.7-1~deb13u3）以上を両ステージで保証する。
FROM python:3.14.9-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade libssl3t64 openssl \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libssl3t64)" ge '3.5.7-1~deb13u3' \
    && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir pip==26.2.2

# ---- ステージ 1: 依存をインストール --------------------------------------
FROM base AS builder

WORKDIR /app

# まず requirements だけコピーして pip install する。
# こうするとソースだけ変えた再ビルドで pip キャッシュが効く。
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- ステージ 2: 実行イメージ ------------------------------------------
FROM base AS runtime

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
# --no-access-log: アクセスログは app/middleware.py が JSON で出す（Issue #170）ので、
# uvicorn 標準のアクセスログは止めて 1 リクエスト 2 行にならないようにする。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
