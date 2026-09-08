"""画像の検証・加工の単体テスト（app/services/image.py）。

DB もストレージも使わないので `integration` マーカーは付けない
（Docker が無い環境でも `pytest -m 'not integration'` で動く）。
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.config import settings
from app.errors import AppError
from app.services.image import (
    build_image_url,
    build_object_key,
    process_image,
    read_upload_within_limit,
)


def make_image(fmt: str, size: tuple[int, int] = (100, 80), mode: str = "RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, (120, 200, 60) if mode == "RGB" else (120, 200, 60, 255)).save(buf, fmt)
    return buf.getvalue()


# --- 形式の判定（BB: 対応 3 形式 ＋ 非対応） --------------------------


@pytest.mark.parametrize(
    ("fmt", "expected_type", "expected_ext"),
    [
        ("JPEG", "image/jpeg", "jpg"),
        ("PNG", "image/png", "png"),
        ("WEBP", "image/webp", "webp"),
    ],
)
def test_対応形式はそのままの形式で保存される(fmt, expected_type, expected_ext):
    result = process_image(make_image(fmt))
    assert result.content_type == expected_type
    assert result.extension == expected_ext
    # 出力が本当にその形式で読み戻せること
    assert Image.open(io.BytesIO(result.data)).format == fmt


def test_非対応形式は400になる():
    with pytest.raises(AppError) as exc:
        process_image(make_image("GIF"))
    assert exc.value.status_code == 400
    assert exc.value.details == {"format": "GIF"}


def test_画像でないデータは400になる():
    # 拡張子だけ画像でも中身がテキストなら弾く（Content-Type を信用しない）。
    with pytest.raises(AppError) as exc:
        process_image(b"this is definitely not an image")
    assert exc.value.status_code == 400


def test_途中で切れた画像は400になる():
    truncated = make_image("PNG")[:40]
    with pytest.raises(AppError) as exc:
        process_image(truncated)
    assert exc.value.status_code == 400


# --- 縮小（WB: 上限の内側 / 外側の分岐） ------------------------------


def test_長辺が上限を超える画像は縮小される():
    over = settings.IMAGE_MAX_DIMENSION * 2
    result = process_image(make_image("JPEG", size=(over, over // 2)))
    width, height = Image.open(io.BytesIO(result.data)).size
    assert max(width, height) == settings.IMAGE_MAX_DIMENSION
    # 縦横比が保たれていること（2:1 のまま）
    assert width == height * 2


def test_上限以下の画像は拡大されない():
    result = process_image(make_image("JPEG", size=(50, 40)))
    assert Image.open(io.BytesIO(result.data)).size == (50, 40)


def test_透過PNGはPNGのまま保存され透過が保たれる():
    result = process_image(make_image("PNG", mode="RGBA"))
    out = Image.open(io.BytesIO(result.data))
    assert out.format == "PNG"
    assert out.mode in ("RGBA", "LA", "P")


# --- EXIF（回転の正規化 ＋ 除去） -------------------------------------


def test_EXIFの回転が反映されEXIF自体は除去される():
    # Orientation=6 は「時計回りに 90 度回して表示する」の意味。
    # 横長（100x40）で保存 → 回転が反映されて縦長（40x100）になるはず。
    buf = io.BytesIO()
    image = Image.new("RGB", (100, 40), (10, 20, 30))
    exif = image.getexif()
    exif[274] = 6  # 274 = Orientation タグ
    image.save(buf, "JPEG", exif=exif)

    result = process_image(buf.getvalue())
    out = Image.open(io.BytesIO(result.data))
    assert out.size == (40, 100), "EXIF の回転がピクセルに反映されていない"
    # 再エンコードで EXIF は落ちている（GPS 等を公開バケットに置かないため）
    assert dict(out.getexif()) == {}


# --- サイズ上限（BB: 境界値） ----------------------------------------


def test_上限ちょうどは通る():
    data = b"x" * settings.IMAGE_MAX_BYTES
    assert read_upload_within_limit(io.BytesIO(data)) == data


def test_上限を1バイト超えると400になる():
    data = b"x" * (settings.IMAGE_MAX_BYTES + 1)
    with pytest.raises(AppError) as exc:
        read_upload_within_limit(io.BytesIO(data))
    assert exc.value.status_code == 400
    assert exc.value.details == {"maxBytes": settings.IMAGE_MAX_BYTES}


def test_空ファイルは400になる():
    with pytest.raises(AppError) as exc:
        read_upload_within_limit(io.BytesIO(b""))
    assert exc.value.status_code == 400


# --- 画素数の上限（decompression bomb 対策） ---------------------------


def test_画素数が上限を超える画像は400になる(monkeypatch):
    """バイト数が小さくても、展開すると巨大になる画像を弾けること。

    ベタ塗りの PNG は数百バイトまで圧縮されるので、`IMAGE_MAX_BYTES` の
    検査だけでは通り抜けてしまう（decompression bomb）。実際に何千万画素も
    ある画像をテストで作るとメモリと時間を食うため、上限側を極端に下げて
    「`load()` でピクセルを確保する前に弾けているか」だけを確かめる。
    """
    monkeypatch.setattr(settings, "IMAGE_MAX_PIXELS", 100)

    # 100x80 = 8,000 画素 > 100。データ自体は 1KB 未満。
    with pytest.raises(AppError) as exc:
        process_image(make_image("PNG"))

    assert exc.value.status_code == 400
    assert exc.value.details == {"maxPixels": 100}


def test_画素数が上限内なら通る(monkeypatch):
    monkeypatch.setattr(settings, "IMAGE_MAX_PIXELS", 8_000)  # ちょうど 100x80

    result = process_image(make_image("PNG"))
    assert result.content_type == "image/png"


# --- キーと URL -------------------------------------------------------


def test_オブジェクトキーは推測できないランダム値になる():
    a = build_object_key("jpg")
    b = build_object_key("jpg")
    assert a != b, "キーが重複している（総当たりで他人の画像に到達できてしまう）"
    assert a.startswith("uploads/") and a.endswith(".jpg")


def test_URLはキーから組み立てられる():
    url = build_image_url("uploads/abc.jpg")
    assert url == f"{settings.S3_PUBLIC_URL_BASE.rstrip('/')}/uploads/abc.jpg"
