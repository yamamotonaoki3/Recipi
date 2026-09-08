"""一時アップロード GC ＋ ストレージ削除ジョブの結合テスト（Issue #39）。

実 PostgreSQL ＋ 実 MinIO に対して実行する。
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from PIL import Image
from sqlmodel import Session, select

from app import storage
from app.config import settings
from app.jobs.gc_uploads import collect_garbage
from app.jobs.storage_deletion import MAX_ATTEMPTS, process_queue
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload, UploadStatus
from app.models.user import User
from tests.helpers import signup

pytestmark = pytest.mark.integration


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 20), (5, 90, 160)).save(buf, "PNG")
    return buf.getvalue()


def make_upload(
    db_session: Session,
    user_id: uuid.UUID,
    *,
    status: UploadStatus,
    created_at: datetime | None = None,
    expires_at: datetime | None = None,
    put_object: bool = False,
) -> Upload:
    """任意の状態・時刻の管理行を直接作る（時間を待たずに GC を検証するため）。"""
    now = datetime.now(UTC)
    key = f"uploads/{uuid.uuid4()}.png"
    if put_object:
        storage.put_object(key, png_bytes(), "image/png")

    row = Upload(
        user_id=user_id,
        key=key,
        status=status,
        content_type="image/png",
        size_bytes=len(png_bytes()),
        expires_at=expires_at or (now + timedelta(hours=1)),
        created_at=created_at or now,
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def user_id(client, db_session) -> uuid.UUID:
    email = signup(client)["email"]
    user: User = db_session.exec(select(User).where(User.email == email)).one()
    return user.id


def queued_keys(db_session: Session) -> set[str]:
    db_session.expire_all()
    return {r.key for r in db_session.exec(select(PendingStorageDeletion)).all()}


# --- GC の対象判定（WB: 状態 × 期限の分岐） ---------------------------


def test_期限切れのpendingは回収される(db_session, user_id):
    past = datetime.now(UTC) - timedelta(minutes=1)
    row = make_upload(db_session, user_id, status="pending", expires_at=past)

    assert collect_garbage(db_session) >= 1
    db_session.commit()

    assert row.key in queued_keys(db_session)
    assert db_session.exec(select(Upload).where(Upload.key == row.key)).first() is None


def test_期限内のpendingは残る(db_session, user_id):
    future = datetime.now(UTC) + timedelta(hours=1)
    row = make_upload(db_session, user_id, status="pending", expires_at=future)

    collect_garbage(db_session)
    db_session.commit()

    assert row.key not in queued_keys(db_session)
    assert db_session.exec(select(Upload).where(Upload.key == row.key)).first() is not None


def test_猶予を過ぎたstoredは回収される(db_session, user_id):
    old = datetime.now(UTC) - timedelta(seconds=settings.UPLOAD_STORED_TTL_SECONDS + 60)
    row = make_upload(db_session, user_id, status="stored", created_at=old)

    collect_garbage(db_session)
    db_session.commit()

    assert row.key in queued_keys(db_session)


def test_猶予内のstoredは残る(db_session, user_id):
    row = make_upload(db_session, user_id, status="stored")

    collect_garbage(db_session)
    db_session.commit()

    assert row.key not in queued_keys(db_session)


def test_consumedは古くても回収されない(db_session, user_id):
    """本参照済みの画像を GC が消してしまうと、レシピの画像が壊れる。"""
    old = datetime.now(UTC) - timedelta(days=365)
    row = make_upload(db_session, user_id, status="consumed", created_at=old, expires_at=old)

    collect_garbage(db_session)
    db_session.commit()

    assert row.key not in queued_keys(db_session)
    assert db_session.exec(select(Upload).where(Upload.key == row.key)).first() is not None


# --- ストレージ削除ジョブ ---------------------------------------------


def test_キューのオブジェクトが実際に削除されキューも空になる(db_session, user_id):
    row = make_upload(
        db_session,
        user_id,
        status="stored",
        created_at=datetime.now(UTC) - timedelta(seconds=settings.UPLOAD_STORED_TTL_SECONDS + 60),
        put_object=True,
    )
    assert storage.object_exists(row.key)

    collect_garbage(db_session)
    db_session.commit()

    succeeded, failed = process_queue(db_session)
    assert succeeded >= 1 and failed == 0
    assert not storage.object_exists(row.key)
    assert row.key not in queued_keys(db_session)


def test_存在しないオブジェクトの削除も成功扱いになる(db_session):
    """削除キューは重複登録を許すので、2 回目以降は「もう無い」になる。

    これをエラーにすると削除ジョブが同じ行を永久に再試行してしまう。
    """
    key = f"uploads/{uuid.uuid4()}.png"
    db_session.add(PendingStorageDeletion(key=key, reason="test_missing"))
    db_session.commit()

    succeeded, failed = process_queue(db_session)
    assert succeeded >= 1 and failed == 0
    assert key not in queued_keys(db_session)


def test_同じキーが重複してキューにあっても両方成功扱いで消化される(db_session):
    """同じオブジェクトを指す削除キューが複数あっても、両方を成功として処理する。"""
    key = f"uploads/{uuid.uuid4()}.png"
    storage.put_object(key, png_bytes(), "image/png")
    db_session.add_all(
        [
            PendingStorageDeletion(key=key, reason="test_duplicate_1"),
            PendingStorageDeletion(key=key, reason="test_duplicate_2"),
        ]
    )
    db_session.commit()

    succeeded, failed = process_queue(db_session)

    assert (succeeded, failed) == (2, 0)
    assert not storage.object_exists(key)
    assert key not in queued_keys(db_session)


def test_試行回数の上限を超えた行は再試行されない(db_session):
    key = f"uploads/{uuid.uuid4()}.png"
    db_session.add(PendingStorageDeletion(key=key, reason="test_exhausted", attempts=MAX_ATTEMPTS))
    db_session.commit()

    succeeded, failed = process_queue(db_session)
    assert (succeeded, failed) == (0, 0)
    # 調査できるよう行は残す
    assert key in queued_keys(db_session)
