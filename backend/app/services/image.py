"""アップロードされた画像の検証と加工（Pillow）。

## やっていること

1. **形式の判定を実データで行う**。`Content-Type` ヘッダーやファイル名の
   拡張子はクライアントが自由に付けられるので信用しない。Pillow に実際に
   開かせて、JPEG / PNG / WebP のいずれかだったときだけ通す
   （features/image.md §6）。
2. **EXIF の回転を画像そのものに反映する**。スマホで撮った写真は
   「センサーの向きのまま保存し、正しい向きは EXIF の Orientation に
   書いておく」形式が多い。EXIF を無視して表示すると横倒しになるため、
   `ImageOps.exif_transpose()` でピクセルを回してしまう。
3. **長辺を上限まで縮小する**。クライアント（#40）でも縮小するが、
   不正なクライアントが巨大な画像を送ってきてもサーバー側で必ず収める。
4. **再エンコードする**。この過程で EXIF が落ちる。これは副作用ではなく
   **意図した動作**で、写真に埋め込まれた GPS 位置情報や端末情報を
   そのまま公開バケットに置かないためのプライバシー対策でもある。

## サイズ上限の当て方

「全部読んでから長さを測る」と、悪意のある巨大ファイルでメモリを食える。
`read_upload_within_limit()` は **上限 + 1 バイトまでしか読まない**ので、
超過分は読み込まずに 400 を返せる。
"""

from __future__ import annotations

import io
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import BinaryIO, Final

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlmodel import Session, select

from app import storage
from app.config import settings
from app.errors import AppError, validation_error
from app.models.pending_storage_deletion import PendingStorageDeletion
from app.models.upload import Upload

logger = logging.getLogger(__name__)

# Pillow が返す形式名 → (Content-Type, 拡張子)。
# ここに無い形式は受け付けない（features/image.md §6）。
_ALLOWED_FORMATS: Final[dict[str, tuple[str, str]]] = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}


class ProcessedImage:
    """加工後の画像データ（保存に必要なものだけを持つ小さな入れ物）。"""

    __slots__ = ("content_type", "data", "extension")

    def __init__(self, data: bytes, content_type: str, extension: str) -> None:
        self.data = data
        self.content_type = content_type
        self.extension = extension


def read_upload_within_limit(stream: BinaryIO) -> bytes:
    """アップロードのストリームを上限まで読み、超過していれば 400 を返す。

    上限 + 1 バイトだけ読んで判定するので、巨大なファイルを丸ごと
    メモリに載せることはない。
    """
    limit = settings.IMAGE_MAX_BYTES
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise validation_error(
            f"画像は 1 枚あたり {limit // (1024 * 1024)}MB までです",
            {"maxBytes": limit},
        )
    if not data:
        raise validation_error("画像ファイルが空です")
    return data


def process_image(data: bytes) -> ProcessedImage:
    """画像を検証し、向きを正して縮小し、再エンコードして返す。

    対応形式でない / 壊れているデータは 400（`validation_error`）。
    """
    buffer = io.BytesIO()
    try:
        # `Image.open` は遅延読み込みなので、この時点ではヘッダーしか見ない。
        #
        # ここで `warnings.catch_warnings()` を使って Pillow の
        # `DecompressionBombWarning` を例外に変換する手もあるが、**使わない**。
        # `catch_warnings()` はプロセス全体で共有される警告フィルタを一時的に
        # 書き換える仕組みで、スレッドローカルではない（GIL 有効ビルドの
        # Python 3.14 では既定でスレッド安全にならない）。FastAPI は同期の
        # `def` エンドポイントをスレッドプールで並行実行するため、別リクエストの
        # 警告設定を巻き込んで壊しうる。
        # 代わりに、下の画素数チェック（Pillow の警告しきい値より厳しい）で
        # 自前に弾き、Pillow が送出する例外だけを except で受ける。
        with Image.open(io.BytesIO(data)) as opened:
            image_format = (opened.format or "").upper()
            if image_format not in _ALLOWED_FORMATS:
                raise validation_error(
                    "対応していない画像形式です（JPEG / PNG / WebP のみ）",
                    {"format": image_format or None},
                )
            content_type, extension = _ALLOWED_FORMATS[image_format]

            # 圧縮された画像はファイル自体が小さくても、展開時には巨大なピクセル
            # 配列になることがある。バイト数だけを検査すると、この段階でメモリを
            # 大量に確保する decompression bomb を防げないため、`load()` より前に
            # ヘッダーの縦横から画素数を検査する。
            width, height = opened.size
            max_pixels = settings.IMAGE_MAX_PIXELS
            if width * height > max_pixels:
                raise validation_error(
                    "画像の画素数が上限を超えています",
                    {"maxPixels": max_pixels},
                )

            # `load()` でピクセルを実際に読む。壊れたファイルはここで落ちる。
            opened.load()

            # EXIF の Orientation をピクセルに反映する（横倒し対策）。
            # `exif_transpose` は新しい Image を返す（EXIF が無ければ複製）。
            oriented = ImageOps.exif_transpose(opened)
            image = oriented if oriented is not None else opened.copy()

        with image:
            # 長辺が上限を超えていれば、縦横比を保ったまま縮小する。
            # `thumbnail` は「指定した箱に収まるように」縮小し、拡大はしない。
            max_side = settings.IMAGE_MAX_DIMENSION
            if max(image.size) > max_side:
                image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

            _save(image, buffer, image_format)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        # Pillow 自身が検出した decompression bomb も、アプリの入力不正として
        # 400 にする（予期しない 500 にして詳細を隠す必要はない）。
        raise validation_error(
            "画像の画素数が上限を超えています",
            {"maxPixels": settings.IMAGE_MAX_PIXELS},
        ) from exc
    except UnidentifiedImageError as exc:
        # 画像として開けなかった（テキストを .jpg にリネームした等）。
        raise validation_error("画像として読み取れませんでした") from exc
    except OSError as exc:
        # 途中で切れているファイルなど。Pillow は OSError を投げる。
        raise validation_error("画像が壊れているか、読み取れませんでした") from exc

    return ProcessedImage(buffer.getvalue(), content_type, extension)


def _save(image: Image.Image, buffer: io.BytesIO, image_format: str) -> None:
    """形式ごとの保存オプションを当てて書き出す。

    `save` に EXIF を渡さないことで、元画像のメタデータ（GPS 位置情報など）は
    保存されない。
    """
    if image_format == "JPEG":
        # JPEG は透過を持てない。PNG から変換したわけではないが、
        # RGBA / P モードの JPEG は保存できないので RGB に落とす。
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        # `optimize` はファイルサイズを詰める。`quality=85` は画質と容量の定番。
        image.save(buffer, format="JPEG", quality=85, optimize=True)
    elif image_format == "PNG":
        # PNG は可逆なので quality は無い。`optimize` で圧縮を試みる。
        image.save(buffer, format="PNG", optimize=True)
    else:  # WEBP
        image.save(buffer, format="WEBP", quality=85, method=4)


def enqueue_object_deletion(session: Session, key: str | None, reason: str) -> None:
    """参照から外れたオブジェクトキーを削除キューに積む（`None` は何もしない）。

    **実際のストレージ削除はここでは行わない**。定期ジョブ
    （app/jobs/storage_deletion.py）に任せることで、S3 / MinIO の障害が
    レシピの保存 / 削除 API に波及しないようにする（processing-model.md §5-2）。
    呼び出し元と同じトランザクションで積むので、コミットされれば
    「あとで必ず消される」ことが保証される。

    あわせて `uploads` の管理行も消す。管理行は「ストレージに存在していて、
    まだ追跡が必要なオブジェクト」を表すもので、削除キューへ移した時点で
    役目を終える。残したままにするとレシピを消すたびに `consumed` 行が
    溜まり続けてしまう。
    """
    if not key:
        return

    session.add(PendingStorageDeletion(key=key, reason=reason))

    upload = session.exec(select(Upload).where(Upload.key == key)).first()
    if upload is not None:
        session.delete(upload)


def build_image_url(key: str) -> str:
    """オブジェクトキーから表示用 URL を組み立てる。

    **画像の正はキーで、URL はそこから導出する派生値**という設計
    （features/image.md §4）。DB には URL を保存しない。

    現在は公開バケット運用なので `S3_PUBLIC_URL_BASE` に連結するだけ。
    本番で非公開バケット ＋ 署名付き URL に移行するときは、**この関数の
    中身だけを差し替えればよい**（DB の移行は不要）。
    """
    return f"{settings.S3_PUBLIC_URL_BASE.rstrip('/')}/{key.lstrip('/')}"


def image_url(key: str | None) -> str | None:
    """オブジェクトキーから表示用 URL を組み立てる（キーが無ければ null）。

    実体は上の `build_image_url`。キーが null のときに null を返すのは、
    クライアントにプレースホルダを出させるため（features/image.md §7）。

    サムネイル・手順画像・アバターのどれにも使う。以前は
    `app/services/recipe.py` にあったが、フォロー・プロフィール・履歴からも
    使うようになったので、どこからでも import できるこの中立なモジュールへ
    移した（recipe ⇄ user のような循環 import を作らないため）。
    """
    if not key:
        return None
    return build_image_url(key)


def stage_upload(session: Session, user_id: uuid.UUID, image: ProcessedImage) -> str:
    """加工済みの画像を「①管理行を作る → ②ストレージに保存する」まで進め、キーを返す。

    `POST /images`（一時アップロード）と `PUT /users/me/avatar` の共通部分。
    その後の「③本参照として確定する」は用途ごとに違うので、呼び出し側が行う。

    ## 順序が大事（processing-model.md §6・§9）

        ① Tx1: uploads に pending 行を INSERT して commit  → キーが確定する
        ② Tx 外: オブジェクトを S3 / MinIO に PUT

    先に DB の行を作っておけば、②で失敗しても行は `pending` のまま残り、
    期限を過ぎれば GC（app/jobs/gc_uploads.py）が回収できる。逆順（先に PUT）に
    すると、PUT 成功後に DB への記録が失敗したとき「誰も知らないオブジェクト」が
    ストレージに残り、後から掃除できない。

    ②をトランザクションの外で行うのは、外部 I/O を待つあいだ DB のロックや
    接続を握り続けないため（processing-model.md §2）。

    **この関数は①で commit する**（②の前にキーを確定させる必要があるため）。
    """
    key = build_object_key(image.extension)

    # --- ① Tx1: pending 行を作ってキーを確定する ------------------------
    now = datetime.now(UTC)
    session.add(
        Upload(
            user_id=user_id,
            key=key,
            status="pending",
            content_type=image.content_type,
            size_bytes=len(image.data),
            expires_at=now + timedelta(seconds=settings.UPLOAD_PENDING_TTL_SECONDS),
            created_at=now,
        )
    )
    session.commit()

    # --- ② Tx 外: オブジェクトを保存する --------------------------------
    try:
        storage.put_object(key, image.data, image.content_type)
    except Exception:
        # 行は `pending` のまま残る。期限を過ぎれば GC が回収するので、
        # ここで後始末をする必要はない（できることも無い）。
        logger.exception("オブジェクトの保存に失敗しました key=%s", key)
        raise AppError(500, "STORAGE_ERROR", "画像の保存に失敗しました") from None

    return key


def build_object_key(extension: str) -> str:
    """保存先のオブジェクトキーを作る。

    公開バケット運用なので、**キーは推測できてはいけない**。
    ユーザー ID や連番を含めると他人の画像 URL を総当たりできてしまうため、
    ランダムな UUID だけを使う。
    """
    return f"uploads/{uuid.uuid4()}.{extension}"
