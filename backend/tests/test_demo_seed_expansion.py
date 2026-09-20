"""拡張版READMEデモデータの件数と表示パターンを守る。"""

from scripts.demo_seed_expansion import (
    ADDITIONAL_COMMENTS,
    ADDITIONAL_FOLLOWS,
    ADDITIONAL_NOTIFICATIONS,
    ADDITIONAL_RECIPES,
    ADDITIONAL_USERS,
    UNFAVORITED_RECIPE_SLUG,
    UNFOLLOWED_USER_EMAIL,
)


def test_demo_expansion_completes_ten_entity_dataset() -> None:
    assert len(ADDITIONAL_USERS) == 7
    assert len(ADDITIONAL_RECIPES) == 7
    assert len(ADDITIONAL_COMMENTS) == 6
    assert len(ADDITIONAL_NOTIFICATIONS) == 6


def test_demo_expansion_includes_unfollowed_user_and_unfavorited_recipe() -> None:
    assert UNFOLLOWED_USER_EMAIL == "demo.kai@example.com"
    assert UNFAVORITED_RECIPE_SLUG == "apple-crumble"


def test_demo_expansion_has_mixed_follow_relationships() -> None:
    """相互・片方向・未フォローをプロフィール画面で確認できる。"""
    assert ("demo.ema@example.com", "demo.riku@example.com") in ADDITIONAL_FOLLOWS
    assert ("demo.riku@example.com", "demo.ema@example.com") in ADDITIONAL_FOLLOWS
    assert ("demo.noa@example.com", "demo.yui@example.com") in ADDITIONAL_FOLLOWS
    assert all(followee != UNFOLLOWED_USER_EMAIL for _, followee in ADDITIONAL_FOLLOWS)
    assert len(ADDITIONAL_FOLLOWS) == 11
