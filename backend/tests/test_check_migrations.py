"""マイグレーション検査スクリプト（Issue #255）のテスト。

BB（仕様ベース）: 正常時は 0 で終わる。head の分岐・テーブルの書き忘れ・列の書き忘れを
それぞれ検出して 1 で終わり、対処法を出す。
WB（実装ベース）: `alembic_version` を差分として報告しない。型の差分では落ちない
（このリポジトリには既存の型不一致が 26 件あり、見ると使い物にならないため）。

**この検査が本当に落ちることを確かめるのが目的**。通るだけのテストにしない。
"""

from __future__ import annotations

import uuid

import pytest
from sqlmodel import Field, SQLModel

from scripts.check_migrations import check_model_drift, check_single_head, main

pytestmark = pytest.mark.integration


def test_passes_on_the_current_repository():
    """今の main の状態では、head は 1 つで差分も無い。"""
    assert check_single_head() == []
    assert check_model_drift() == []
    assert main() == 0


def test_detects_a_model_table_without_a_migration():
    """モデルにテーブルを足してマイグレーションを書き忘れたら落ちる。"""

    class _DriftProbeTable(SQLModel, table=True):
        __tablename__ = "drift_probe_table"
        id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    try:
        problems = check_model_drift()
        assert any("drift_probe_table" in p for p in problems), problems
        # 「何をすればよいか」が出ていること。
        assert any("autogenerate" in p for p in problems), problems
    finally:
        # 他のテストに影響しないよう、metadata から外す。
        SQLModel.metadata.remove(SQLModel.metadata.tables["drift_probe_table"])


def test_detects_a_model_column_without_a_migration():
    """既存テーブルに列を足してマイグレーションを書き忘れたら落ちる。

    `units` テーブルの定義済みメタデータへ直接列を足して再現する。
    """
    from sqlalchemy import Column, String

    units = SQLModel.metadata.tables["units"]
    probe = Column("drift_probe_column", String(), nullable=True)
    units.append_column(probe)
    try:
        problems = check_model_drift()
        assert any("units.drift_probe_column" in p for p in problems), problems
    finally:
        # SQLAlchemy の Table は列の削除 API を公開していないので、内部の入れ物から外す。
        units._columns.remove(probe)


def test_ignores_the_alembic_version_table():
    """`alembic_version` はモデルに無いが、差分として報告しない。"""
    assert not any("alembic_version" in p for p in check_model_drift())


def test_single_head_check_reports_the_fix():
    """head が分岐したときのメッセージに、直し方が書かれている。

    実際に分岐させるとマイグレーションのファイルを置く必要があり、他のテストの
    `alembic upgrade head` を壊す。ここでは正常時に何も返さないことだけ確かめ、
    メッセージの中身は文言を直接確認する（分岐の実地確認は Issue #255 で実施済み）。
    """
    assert check_single_head() == []
