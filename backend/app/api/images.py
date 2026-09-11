"""`POST /api/v1/images` エンドポイント（features/image.md §5）。

画像 1 枚を**一時アップロード**し、`{key, url}` を返す。返ってきた `key` を
レシピ保存の body（`thumbnailKey` / `steps[].imageKey`）に入れることで、
初めて「本参照」になる。

## 3 段構成にする理由（processing-model.md §9）

    ① Tx1: uploads に pending 行を INSERT して commit  → キーが確定する
    ② Tx 外: 画像を検証・加工して S3 に PUT
    ③ Tx2: 行をロックして pending なら stored に更新   → {key, url} を返す

**なぜ「先に DB、あとでストレージ」なのか**: 逆順（先に PUT）にすると、
PUT は成功したが DB の記録に失敗した場合に「オブジェクトはあるが、
それを知っている記録がどこにも無い」状態になり、後から掃除できない。
先に行を作っておけば、②で失敗しても行は `pending` のまま残るので、
GC（app/jobs/gc_uploads.py）が期限切れとして回収できる。

**なぜ②を Tx の外に出すのか**: ストレージへの PUT は外部 I/O で、遅いことも
落ちることもある。DB のトランザクションを開いたまま待つと、その間ロックを
握り続けて他のリクエストを止めてしまう（processing-model.md §2）。

**③で行が消えていたら**: GC が先に回収した等のレアケース。このとき②で
書いたオブジェクトは誰からも参照されない孤児になるので、削除キューに積んで
から 5xx を返す。「消える予定のキー」を成功として返さないことが大事。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlmodel import Session, select

from app.db import get_session
from app.dependencies import get_current_user
from app.errors import AppError, ErrorEnvelope
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload
from app.models.user import User
from app.schemas.image import ImageUploadResponse
from app.services import image as image_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["images"])


@router.post(
    "/images",
    status_code=status.HTTP_201_CREATED,
    responses={code: {"model": ErrorEnvelope} for code in (400, 401, 500)},
)
def upload_image(
    file: UploadFile = File(..., description="JPEG / PNG / WebP の画像 1 枚"),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ImageUploadResponse:
    # --- 検証と加工（DB にもストレージにも触る前に済ませる） -------------
    # ここで弾ければ `pending` 行もオブジェクトも作らずに済む。
    raw = image_service.read_upload_within_limit(file.file)
    processed = image_service.process_image(raw)

    # --- ① Tx1 ＋ ② Tx 外の保存 -----------------------------------------
    # アバター（PUT /users/me/avatar）と共通なので `stage_upload` にまとめてある。
    # ①で commit してキーを確定させてから②で保存する（順序の理由は関数のコメント）。
    key = image_service.stage_upload(session, current_user.id, processed)

    # --- ③ Tx2: 行をロックして pending なら stored にする ---------------
    # `with_for_update()` = SELECT ... FOR UPDATE。GC や他のリクエストが
    # 同じ行を同時に触らないよう直列化する（processing-model.md §9）。
    locked = session.exec(select(Upload).where(Upload.key == key).with_for_update()).first()

    if locked is None or locked.expires_at <= datetime.now(UTC):
        # 行が消えている / 期限切れ。②で書いたオブジェクトは孤児になるので
        # 削除キューに積む。**同じトランザクションで commit** することで、
        # 「あとで必ず消される」ことを保証してから 5xx を返す。
        session.add(
            PendingStorageDeletion(
                key=key,
                reason="upload_finalize_failed",
            )
        )
        session.commit()
        logger.warning("アップロードの確定に失敗しました（行が無い / 期限切れ） key=%s", key)
        raise AppError(500, "STORAGE_ERROR", "画像の保存に失敗しました")

    locked.status = "stored"
    session.add(locked)
    session.commit()

    # URL はキーから導出する（DB には保存しない）。将来ここを署名付き URL に
    # するときも、差し替えるのは `build_image_url` の中身だけで済む。
    return ImageUploadResponse(key=key, url=image_service.build_image_url(key))
