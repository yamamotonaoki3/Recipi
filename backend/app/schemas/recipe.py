"""`/recipes` エンドポイントのリクエスト/レスポンススキーマ。

バリデーションの正は features/recipe.md §2 の入力項目表。上限値のうち
「実装時に決定」とされていたもの（docs/requirements/todo.md #37・#9）は
本 Issue で以下に確定した:

- 材料グループ数: 1〜20（`MAX_INGREDIENT_GROUPS`）
- グループあたり材料数: 1〜50（`MAX_INGREDIENTS_PER_GROUP`）
- 手順数: 1〜100（`MAX_STEPS`）
- 検索 `q`: 最大 5 語 / 各語 30 文字（`MAX_SEARCH_TERMS` / `MAX_SEARCH_TERM_LENGTH`）

これらは API 層（このスキーマ）で担保する。DB の CHECK 制約にはしない
（product 上の上限であって、データ整合性の不変条件ではないため）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.schemas.base import CamelModel

# 数量は DB では NUMERIC(10, 3)。API 側でも同じ精度・桁数に収める
# （そろえておかないと、request バリデーションは通るのに commit 時に
# DB エラーで 500 になる。Codex #37 レビュー指摘）。
QUANTITY_MAX_DIGITS = 10
QUANTITY_DECIMAL_PLACES = 3


def _reject_blank(value: str) -> str:
    """前後の空白を除いて空になる必須文字列（空白だけの入力）を拒否する。

    保存前に `.strip()` するフィールド（title / 材料名）は、生の長さだけ
    見て `min_length=1` を通しても、実際には空文字が保存されてしまう
    （Codex #37 レビュー指摘）。正規化後の値で検証する。
    """
    if not value.strip():
        raise ValueError("必須項目です（空白のみにはできません）")
    return value


def _blank_to_none(value: object) -> object:
    """画像キーの空文字・空白だけの入力を「未指定」にそろえる。

    画像キーは、文字列が入っているときだけ Upload の存在確認と消費処理を
    行う値。空文字をそのまま残すと「キーが無い」のに DB には文字列が保存され、
    表示も削除もできない行になってしまうため、DB に渡す前に None へ正規化する。
    `mode="before"` で文字列以外はそのまま後段の型チェックへ渡す。
    """
    if isinstance(value, str) and not value.strip():
        return None
    return value


# --- 上限値（todo #37・#9 の確定分） ---------------------------------------
MAX_INGREDIENT_GROUPS = 20
MAX_INGREDIENTS_PER_GROUP = 50
MAX_STEPS = 100
MAX_SEARCH_TERMS = 5
MAX_SEARCH_TERM_LENGTH = 30

TITLE_MAX = 120
DESCRIPTION_MAX = 2000
SERVINGS_MIN = 1
SERVINGS_MAX = 99
GROUP_NAME_MAX = 40
INGREDIENT_NAME_MAX = 60
UNIT_MAX = 20
STEP_BODY_MAX = 1000


# --- リクエスト ----------------------------------------------------------


class IngredientInput(CamelModel):
    name: str = Field(min_length=1, max_length=INGREDIENT_NAME_MAX)
    # 数量は任意。入力するなら 0 より大きい数値（小数可）。
    # max_digits / decimal_places は DB の NUMERIC(10, 3) に合わせる。
    quantity: Decimal | None = Field(
        default=None,
        gt=0,
        max_digits=QUANTITY_MAX_DIGITS,
        decimal_places=QUANTITY_DECIMAL_PLACES,
    )
    unit: str | None = Field(default=None, max_length=UNIT_MAX)
    # 別レシピへのリンク。本人所有・自己参照不可の検証は service 層で行う。
    ref_recipe_id: uuid.UUID | None = None

    _reject_blank_name = field_validator("name")(_reject_blank)


class IngredientGroupInput(CamelModel):
    # グループ名は任意（null / 空 = 名前なしグループ）。
    name: str | None = Field(default=None, max_length=GROUP_NAME_MAX)
    ingredients: list[IngredientInput] = Field(min_length=1, max_length=MAX_INGREDIENTS_PER_GROUP)


class StepInput(CamelModel):
    # 本文が空 / 空白のみの手順行は service 層で送信前に除外する
    # （features/recipe.md §2・§7）。ここで min_length=1 にすると
    # 「空行を残して保存 → その行は保存されない」という受け入れ基準を
    # 満たせず 400 になってしまうため、上限だけ縛る。
    body: str = Field(max_length=STEP_BODY_MAX)
    image_key: str | None = None

    _normalize_blank_image_key = field_validator("image_key", mode="before")(_blank_to_none)


class RecipeWriteRequest(CamelModel):
    """`POST /recipes` と `PUT /recipes/{id}` 共通のリクエスト body。

    `PUT` の「`thumbnailKey` 省略 = サムネイル変更なし」は、ルーター側で
    `model_fields_set` に `"thumbnail_key"` が含まれるかで判定する
    （features/recipe.md §5「省略 = 変更なし / null = 削除 / 既存キー再送 = 維持 /
    新キー = 差し替え」）。
    """

    title: str = Field(min_length=1, max_length=TITLE_MAX)
    description: str = Field(default="", max_length=DESCRIPTION_MAX)
    servings: int = Field(ge=SERVINGS_MIN, le=SERVINGS_MAX)
    is_public: bool = False
    thumbnail_key: str | None = None
    ingredient_groups: list[IngredientGroupInput] = Field(
        min_length=1, max_length=MAX_INGREDIENT_GROUPS
    )
    steps: list[StepInput] = Field(min_length=1, max_length=MAX_STEPS)

    _reject_blank_title = field_validator("title")(_reject_blank)
    _normalize_blank_thumbnail_key = field_validator("thumbnail_key", mode="before")(_blank_to_none)


# --- レスポンス --------------------------------------------------------


class RecipeAuthor(CamelModel):
    id: uuid.UUID
    display_name: str
    # `users.avatar_key` から組み立てた表示用 URL。アバターが無ければ null
    # （組み立ては app/services/recipe.py の `author_of`）。
    avatar_url: str | None = None


class RefRecipe(CamelModel):
    # 参照先が生きている: {id, title}
    # 参照先が削除済み: {id: null, title: "<スナップショット>"}
    id: uuid.UUID | None
    title: str


class IngredientOutput(CamelModel):
    name: str
    quantity: Decimal | None
    unit: str | None
    # 単位の表示位置（features/unit.md §3.1。整形はクライアント側で行う）。
    placement: str
    ref_recipe: RefRecipe | None


class IngredientGroupOutput(CamelModel):
    name: str | None
    ingredients: list[IngredientOutput]


class StepOutput(CamelModel):
    body: str
    image_url: str | None
    # 画像の「オブジェクトキー」。編集画面は PUT（全入れ替え）で既存画像を
    # 維持するためにこのキーを再送する必要がある（features/recipe.md §5）。
    # image_url は表示用の派生値でキーの代わりにはならない。
    image_key: str | None


class RecipeResponse(CamelModel):
    id: uuid.UUID
    author: RecipeAuthor
    title: str
    description: str
    servings: int
    is_public: bool
    thumbnail_url: str | None
    # サムネイルのオブジェクトキー（PUT で「省略 = 変更なし」を選ぶか、
    # 明示的に同じキーを再送するかは画面側の判断。features/recipe.md §5）。
    thumbnail_key: str | None
    is_favorited: bool  # Phase 6 まで常に false
    favorite_count: int
    comment_count: int
    ingredient_groups: list[IngredientGroupOutput]
    steps: list[StepOutput]
    created_at: datetime
    updated_at: datetime


class RecipeSummary(CamelModel):
    """ユーザーごとのレシピ一覧のカード 1 枚分。

    `GET /users/me/recipes`（自分のレシピ一覧）と `GET /users/{id}/recipes`
    （ユーザープロフィールのレシピ一覧）で共通。

    レシピカード（screens/components.md）は全一覧で投稿者（アバター ＋ 表示名）と
    お気に入り数を出すため、`author` と `favorite_count` を Issue #67 で足した。
    frontend はこの型を名前で参照している（`features/recipe/api.ts`）ので、
    **名前と既存の項目は変えず、項目を足すだけ**にしている。
    `is_public` は本人が見るときに「非公開」バッジを出すのに使う。
    """

    id: uuid.UUID
    title: str
    thumbnail_url: str | None
    is_public: bool
    created_at: datetime
    author: RecipeAuthor
    favorite_count: int


class RecipeListResponse(CamelModel):
    items: list[RecipeSummary]
    # カーソルページング（(created_at DESC, id DESC)）。次ページが無ければ null。
    next_cursor: str | None


# --- ホームフィード / 閲覧履歴（Issue #41） --------------------------------


class RecipeFeedItem(CamelModel):
    """ホームフィードのレシピカード 1 枚分（features/home-feed.md §5）。

    自分のレシピ一覧（`RecipeSummary`）と違い、他人のレシピも並ぶので
    投稿者情報（`author`）を含める。`is_public` は公開レシピしか出さないため
    持たせない。`favorite_count` は `recipes.favorite_count`（カウント列
    キャッシュ）をそのまま返す（Phase 6 でお気に入り機能が入るまでは 0）。
    """

    id: uuid.UUID
    title: str
    thumbnail_url: str | None
    author: RecipeAuthor
    favorite_count: int


class RecipeFeedResponse(CamelModel):
    items: list[RecipeFeedItem]
    # カーソルページング（(created_at DESC, id DESC)）。次ページが無ければ null。
    next_cursor: str | None


class HistoryItem(RecipeFeedItem):
    """閲覧履歴の 1 件。フィードのカード形状 ＋ 「最後に見た時刻」（view-history.md §5）。"""

    viewed_at: datetime


class HistoryResponse(CamelModel):
    items: list[HistoryItem]
    # カーソルページング（(viewed_at DESC, recipe_id DESC)）。次ページが無ければ null。
    next_cursor: str | None
