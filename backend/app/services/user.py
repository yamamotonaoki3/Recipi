"""プロフィール（表示名・アバター・連絡先 / SNS の公開設定）のドメインロジック。

features/profile.md。ルーター（app/api/users.py）は HTTP の入出力だけを担う。

## このモジュールは基本的に commit しない

書き込み関数は `session.commit()` を呼ばず、ルーターが `return` の前に
commit する（app/db.py のコメント: 依存性の自動コミットはレスポンス送信後に
走るため、直後の別リクエストが古い状態を見てしまう）。

例外はアバターの保存。ストレージへの保存をトランザクションの外で行うため、
途中でトランザクションを区切る必要がある（`set_avatar` のコメント）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import BinaryIO

from sqlmodel import Session, select

from app.errors import AppError, not_found
from app.models.upload import Upload
from app.models.user import User
from app.schemas.follow import (
    ProfileLinks,
    UserPublicProfileResponse,
    UserSelfProfileResponse,
)
from app.schemas.user import UpdateMeRequest, UserMeResponse
from app.services import image as image_service
from app.services.follow import resolve_following_flags
from app.services.image import image_url

# `PATCH /users/me` で書き換えてよい列（リクエストの項目名 = モデルの列名）。
_UPDATABLE_FIELDS = frozenset(
    {
        "display_name",
        "email_public",
        "x_url",
        "x_public",
        "instagram_url",
        "instagram_public",
        "other_url",
        "other_public",
    }
)

# アバターの行をロックするときの指定。`{"key_share": True}` は
# `SELECT ... FOR NO KEY UPDATE`（主キーは変えない更新）。フォローの処理と
# 同じロックの種類にそろえ、同じユーザー行を触る処理どうしを順番待ちにする
# （app/services/follow.py の `_lock_users_in_id_order` のコメント②）。
_LOCK_USER_ROW = {"key_share": True}


def _utcnow() -> datetime:
    return datetime.now(UTC)


# --- 本人の設定 -------------------------------------------------------


def me_response(user: User) -> UserMeResponse:
    """本人向けの設定一式（`PATCH /users/me` の応答）。"""
    return UserMeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=image_url(user.avatar_key),
        email_public=user.email_public,
        x_url=user.x_url,
        x_public=user.x_public,
        instagram_url=user.instagram_url,
        instagram_public=user.instagram_public,
        other_url=user.other_url,
        other_public=user.other_public,
    )


def update_me(session: Session, user: User, body: UpdateMeRequest) -> None:
    """`PATCH /users/me`: **送られた項目だけ**を書き換える（profile.md §5）。

    `body.model_fields_set` には、リクエストに実際に含まれていた項目名だけが
    入っている（未指定の項目は入らない）。これを見て書き換える列を決めるので、
    例えば `{"xPublic": true}` だけ送れば他の項目は元のまま残る。

    null を送ってはいけない項目（表示名・トグル）は、スキーマの検証で
    すでに 400 にしてある（`UpdateMeRequest`）。ここに来る値はすべて書き込んでよい。
    """
    sent = body.model_fields_set & _UPDATABLE_FIELDS
    for name in sent:
        setattr(user, name, getattr(body, name))
    if sent:
        user.updated_at = _utcnow()
        session.add(user)


# --- プロフィール取得 -------------------------------------------------


def get_user_profile(
    session: Session, viewer: User, target_id: uuid.UUID
) -> UserSelfProfileResponse | UserPublicProfileResponse:
    """`GET /users/{id}`（features/profile.md §5）。

    **本人**を取得したときは全項目 ＋ 公開トグルの状態を、**他人**を取得したときは
    公開 ON の項目だけを返す（non-functional.md「データの可視性ルール」）。
    どちらの形になるかは「閲覧者と対象が同じ人か」だけで決まる。
    """
    target = session.get(User, target_id)
    if target is None:
        raise not_found("ユーザーが見つかりません")

    if target.id == viewer.id:
        me = me_response(target)
        return UserSelfProfileResponse(
            **me.model_dump(),
            following_count=target.following_count,
            follower_count=target.follower_count,
            is_following=None,
        )

    # --- 他人向け。公開 OFF の値はここで None にし、シリアライズ時にキーごと落とす。
    # 値を「入れてから消す」のではなく、最初から入れない書き方にしておくと、
    # 将来シリアライズ側の処理を変えても非公開の値が漏れる経路が生まれにくい。
    links = ProfileLinks(
        x=target.x_url if target.x_public else None,
        instagram=target.instagram_url if target.instagram_public else None,
        other=target.other_url if target.other_public else None,
    )
    return UserPublicProfileResponse(
        id=target.id,
        display_name=target.display_name,
        avatar_url=image_url(target.avatar_key),
        following_count=target.following_count,
        follower_count=target.follower_count,
        is_following=target.id in resolve_following_flags(session, viewer, [target.id]),
        email=target.email if target.email_public else None,
        links=links,
    )


# --- アバター ---------------------------------------------------------


def set_avatar(session: Session, user: User, stream: BinaryIO) -> str:
    """`PUT /users/me/avatar`: アバターを設定 / 差し替えし、表示用 URL を返す。

    features/image.md §3・processing-model.md §6 の順序で、**壊れた `avatar_key`**
    （指す先にオブジェクトが無い）と**孤児オブジェクト**（誰も指していない）の
    どちらも作らないようにする。

        検証・加工   形式・サイズの不正はここで 400。行もオブジェクトも作らない
        ① Tx1       uploads に pending 行を作って commit（キー確定）   ┐ stage_upload
        ② Tx 外     オブジェクトを S3 / MinIO に保存                   ┘
        ③ Tx2       users.avatar_key を新キーに ＋ 旧キーを削除キューへ
                    ＋ 新キーの行を consumed に（この関数では commit しない）

    - ②で失敗 → 500。`avatar_key` は変わらず、新キーの行は pending のまま GC が回収
    - ③で新キーの行が消えていた / 期限切れ → 新キーを削除キューに積んで commit し 500
    - `avatar_key` が書き換わるのは、オブジェクトの保存が済んだ後の③だけ
    """
    raw = image_service.read_upload_within_limit(stream)
    processed = image_service.process_image(raw)

    key = image_service.stage_upload(session, user.id, processed)  # ①② （①で commit）

    # --- ③ Tx2 -------------------------------------------------------------
    # ロックは「users 行 → uploads 行」の順（フォローと同じく users を先に）。
    #
    # users 行は `select ... with_for_update()` ではなく **`refresh`** でロックする。
    # この User はリクエストの最初に `get_current_user` が読み込んだもので、
    # セッションに載っている。同じ行を select し直しても、SQLAlchemy は
    # 読み込み済みの Python オブジェクト（＝古い `avatar_key`）を返してしまう
    # （lessons-learned「同じセッションで同じ行を 2 回 select しても最新値を読まない」）。
    # 同じ人が同時にアバターを 2 回変えると、後の処理が「最初のアバター」を旧キーと
    # 思い込み、先の処理が設定したキーが誰にも指されないまま残る（孤児）。
    # `refresh(..., with_for_update=...)` はロックと同時に DB の最新値で読み直す
    # （既存のレシピ更新 `services/recipe.py` と同じやり方）。
    session.refresh(user, with_for_update=_LOCK_USER_ROW)

    upload = session.exec(select(Upload).where(Upload.key == key).with_for_update()).first()
    now = _utcnow()
    if (
        upload is None
        or upload.user_id != user.id
        or upload.status != "pending"
        or upload.expires_at <= now
    ):
        # 行が消えている（GC が先に回収した等）/ 期限切れ / 想定外の状態。
        # ②で保存したオブジェクトは誰にも指されないので削除キューに積み、
        # **同じトランザクションで commit してから** 5xx を返す（成功として返さない）。
        image_service.enqueue_object_deletion(session, key, "avatar_finalize_failed")
        session.commit()
        raise AppError(500, "STORAGE_ERROR", "画像の保存に失敗しました")

    old_key = user.avatar_key
    user.avatar_key = key
    user.updated_at = now
    upload.status = "consumed"
    session.add(user)
    session.add(upload)

    # 差し替えで外れた旧アバターは、あとで定期ジョブが実削除する。
    # `enqueue_object_deletion` は旧キーの uploads 行も一緒に消す。
    image_service.enqueue_object_deletion(session, old_key, "avatar_replaced")

    url = image_url(key)
    assert url is not None  # key は空でないので必ず URL になる
    return url


def delete_avatar(session: Session, user: User) -> None:
    """`DELETE /users/me/avatar`: アバターを外す（無ければ何もしない。冪等）。

    1 トランザクションで `avatar_key` を NULL にし、旧キーを削除キューに積む
    （image.md §3）。差し替えと同時に来ても取りこぼさないよう、`set_avatar` と
    同じく `refresh` でロックと読み直しを同時に行う。commit はルーターが行う。
    """
    session.refresh(user, with_for_update=_LOCK_USER_ROW)
    old_key = user.avatar_key
    if old_key is None:
        return

    user.avatar_key = None
    user.updated_at = _utcnow()
    session.add(user)
    image_service.enqueue_object_deletion(session, old_key, "avatar_deleted")
