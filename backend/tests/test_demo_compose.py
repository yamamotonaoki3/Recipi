"""README用デモComposeの画像ストレージ構成を検証する。"""

from __future__ import annotations

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]


def test_demo_compose_defines_an_isolated_minio_service() -> None:
    compose = (_REPO_ROOT / "infra" / "docker-compose.demo.yml").read_text(encoding="utf-8")

    assert "minio-demo:" in compose
    assert '"9002:9000"' in compose
    assert '"9003:9001"' in compose
    assert "minio_demo_data:/data" in compose
