"""FastAPI アプリの OpenAPI 仕様を `openapi/openapi.json` に書き出す。

使い方（backend/ で実行）:
    python -m scripts.export_openapi

CI（contract.yml）はこれを実行して、コミット済みの openapi.json と
差分が無いことを確認する（契約テスト。testing.md §1）。
差分が出たら「API を変えたのに openapi.json を更新し忘れている」ということ。
"""

from __future__ import annotations

import json
import os
import pathlib

# 設定の必須項目（DATABASE_URL 等）が無くても import できるよう、
# ダミー値を先に入れておく（この用途では DB につながないため何でもよい）。
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost:5432/x")

from app.main import app  # noqa: E402  上の環境変数設定より後に import したい

OUTPUT = pathlib.Path(__file__).resolve().parents[2] / "openapi" / "openapi.json"


def main() -> None:
    spec = app.openapi()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        # キーをソートして書くと、生成のたびに順番がブレず diff が安定する。
        json.dump(spec, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
