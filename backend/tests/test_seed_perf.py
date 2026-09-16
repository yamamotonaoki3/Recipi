"""性能テスト用データの投入（`scripts/seed_perf.py`）と後始末（`cleanup_perf.py`）のテスト。

BB: 投入したユーザーは cleanup のパターンに合い、後始末で残数 0 になる。二重投入は拒否する。
WB: 組み立てた行の件数・識別子（`perfuser_` / `[PERF_TEST]`）・カウント列の整合、
    語彙が検索語の上限に収まること、引数と安全装置。

テストデータは `perfuser_…@example.com` と `[PERF_TEST]`（Issue #145）。
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session

from app.db import engine
from app.schemas.recipe import MAX_SEARCH_TERM_LENGTH
from scripts import cleanup_perf, seed_perf
from scripts.cleanup_e2e import CleanupError, cleanup
from scripts.seed_perf import (
    PERF_EMAIL_PATTERN,
    PERF_TAG,
    SeedPlan,
    build_seed,
    count_existing,
    load_vocabulary,
    perf_email,
    seed,
)

NOW = datetime(2026, 9, 16, tzinfo=UTC)


def _like_to_regex(pattern: str) -> re.Pattern[str]:
    """PERF_EMAIL_PATTERN（`\\_` はただの `_`、`%` は任意の文字列）を正規表現にする。"""
    escaped = re.escape(pattern.replace(r"\_", "\0")).replace("%", ".*").replace("\0", "_")
    return re.compile(f"^{escaped}$")


def _build(plan: SeedPlan) -> seed_perf.SeedData:
    return build_seed(plan, load_vocabulary(), now=NOW, password_hash="x", answer_hash="y")


# --- 単体（DB 不要）-------------------------------------------------------------


def test_perf_email_matches_cleanup_pattern() -> None:
    regex = _like_to_regex(PERF_EMAIL_PATTERN)
    assert perf_email(1) == "perfuser_001@example.com"
    assert regex.match(perf_email(1))
    assert regex.match(perf_email(200))
    # E2E・通常のテストユーザーは対象外。
    assert not regex.match("e2euser_x_1@example.com")
    assert not regex.match("testuser_abc@example.com")


def test_vocabulary_terms_fit_search_limit() -> None:
    vocabulary = load_vocabulary()
    assert vocabulary["dishes"] and vocabulary["ingredients"]
    # 検索語は材料名から選ぶ。空白を含むと 2 語に分かれてしまうので含めない。
    for term in vocabulary["ingredients"]:
        assert 0 < len(term) <= MAX_SEARCH_TERM_LENGTH
        assert " " not in term and "　" not in term


def test_build_seed_counts_and_tags() -> None:
    plan = SeedPlan(users=10, recipes=40, follows_per_user=3, favorites_per_user=4)
    data = _build(plan)

    assert len(data.users) == 10
    assert len(data.recipes) == 40
    assert len(data.ingredients) == 40 * seed_perf.INGREDIENTS_PER_RECIPE
    assert len(data.steps) == 40 * seed_perf.STEPS_PER_RECIPE
    assert all(u.email.startswith("perfuser_") for u in data.users)
    assert all(r.title.startswith(PERF_TAG) and r.is_public for r in data.recipes)
    # サムネイルは非公開側に置く。これが無いと一覧 API が署名付き URL の生成を
    # 通らず、本番より軽い状態を測ってしまう（Issue #185）。
    keys = [r.thumbnail_key for r in data.recipes]
    assert all(k is not None and k.startswith("private/") for k in keys)
    assert len(set(keys)) == len(keys), "サムネイルのキーが重複している"
    # 作成日時は新しい順に並ぶ（フィードの並びを検証できるように）。
    created = [r.created_at for r in data.recipes]
    assert created == sorted(created, reverse=True)
    assert created[0] - created[-1] == timedelta(minutes=30 * 39)


def test_build_seed_counts_match_rows() -> None:
    plan = SeedPlan(users=6, recipes=30, follows_per_user=2, favorites_per_user=5)
    data = _build(plan)

    following = Counter(f.follower_id for f in data.follows)
    followers = Counter(f.followee_id for f in data.follows)
    for user in data.users:
        assert user.following_count == following[user.id] == 2
        assert user.follower_count == followers[user.id] == 2

    favorites = Counter(f.recipe_id for f in data.favorites)
    for recipe in data.recipes:
        assert recipe.favorite_count == favorites[recipe.id]
    # 自分のレシピはお気に入りしない。
    owner = {r.id: r.user_id for r in data.recipes}
    assert all(owner[f.recipe_id] != f.user_id for f in data.favorites)


def test_build_seed_is_deterministic_and_caps_follows() -> None:
    first = _build(SeedPlan(users=2, recipes=5, follows_per_user=10))
    second = _build(SeedPlan(users=2, recipes=5, follows_per_user=10))
    assert [r.title for r in first.recipes] == [r.title for r in second.recipes]
    # 2 人しかいなければ、フォローできるのは相手 1 人だけ。
    assert len(first.follows) == 2


def test_build_seed_rejects_empty_plan() -> None:
    with pytest.raises(ValueError):
        _build(SeedPlan(users=0, recipes=1))


@pytest.mark.parametrize("module", [seed_perf, cleanup_perf])
def test_main_requires_yes(module, capsys: pytest.CaptureFixture[str]) -> None:
    assert module.main([]) == 2
    assert "--yes" in capsys.readouterr().err


def test_seed_main_rejects_non_positive_counts(capsys: pytest.CaptureFixture[str]) -> None:
    assert seed_perf.main(["--users", "0", "--yes"]) == 2
    assert "1 以上" in capsys.readouterr().err


def test_insert_stages_put_parents_before_children() -> None:
    """外部キーの親（users → recipes → ingredient_groups）を、子より前の段階に置く。

    まとめて add_all すると子が先に INSERT されて外部キー違反になった（Issue #145 の CI）。
    """
    data = _build(SeedPlan(users=3, recipes=6, follows_per_user=1, favorites_per_user=2))
    stages = data.insert_stages()

    def stage_of(row: object) -> int:
        return next(i for i, rows in enumerate(stages) if any(r is row for r in rows))

    for recipe in data.recipes:
        owner = next(u for u in data.users if u.id == recipe.user_id)
        assert stage_of(owner) < stage_of(recipe)
    for group in data.groups:
        recipe = next(r for r in data.recipes if r.id == group.recipe_id)
        assert stage_of(recipe) < stage_of(group)
    last = len(stages) - 1
    for row in [*data.ingredients, *data.steps, *data.follows, *data.favorites]:
        assert stage_of(row) == last
    # 全行がちょうど 1 回ずつ入っている。
    assert sum(len(rows) for rows in stages) == (
        len(data.users)
        + len(data.recipes)
        + len(data.groups)
        + len(data.ingredients)
        + len(data.steps)
        + len(data.follows)
        + len(data.favorites)
    )


# --- 結合（実 DB）---------------------------------------------------------------


@pytest.mark.integration
def test_seed_then_cleanup_leaves_nothing() -> None:
    data = _build(SeedPlan(users=4, recipes=12, follows_per_user=2, favorites_per_user=3))
    with Session(engine) as session:
        # 前回の失敗で残っていても、このテストの結果が狂わないように先に消す。
        cleanup(session, PERF_EMAIL_PATTERN, dry_run=False, pending_grace=timedelta(hours=1))
    try:
        with Session(engine) as session:
            seed(session, data)
        with Session(engine) as session:
            assert count_existing(session) == 4
            # 二重投入は拒否する（件数が狂うのを防ぐ）。
            with pytest.raises(CleanupError, match="すでにあります"):
                seed(session, _build(SeedPlan(users=1, recipes=1)))
    finally:
        with Session(engine) as session:
            report = cleanup(
                session, PERF_EMAIL_PATTERN, dry_run=False, pending_grace=timedelta(hours=1)
            )
    assert len(report.users) == 4
    assert len(report.recipes) == 12
    with Session(engine) as session:
        assert count_existing(session) == 0
