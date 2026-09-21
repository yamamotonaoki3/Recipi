"""S3 互換オブジェクトストレージ（ローカルは MinIO）への薄いラッパー。

## boto3 とは

AWS 公式の Python SDK。ただし S3 の API は事実上の業界標準になっていて、
MinIO / Cloudflare R2 / Backblaze B2 なども同じ API を喋る。boto3 は
`endpoint_url` を指定できるので、**接続先を設定で差し替えるだけで
ローカルの MinIO から本番のクラウドストレージへ移行できる**。

## なぜ薄く包むのか

- アプリ側のコードに boto3 の型や例外が散らばらないようにする
- 「既に存在しないオブジェクトの削除は成功扱い」のような、このアプリ固有の
  約束事を 1 か所に閉じ込める（削除ジョブの冪等性のため）

## クライアントを毎回作らない理由

boto3 のクライアント生成は署名まわりの初期化を伴い、そこそこ重い。
リクエストのたびに作ると無駄なので、プロセス内で 1 つを使い回す
（`functools.lru_cache` で 1 度だけ作る）。boto3 のクライアントは
スレッドセーフなので、FastAPI が同期エンドポイントをスレッドプールで
並行実行しても問題ない。
"""

from __future__ import annotations

import functools
import json
import logging
from typing import Any
from urllib.parse import urlsplit

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import Settings, settings

logger = logging.getLogger(__name__)


# boto3 は型スタブを同梱していないため、クライアントの型は `Any` になる
# （厳密な型が欲しければ `boto3-stubs[s3]` を入れる手もあるが、依存を
# 増やしてまで得るものは少ないと判断してこの層だけ Any を許容する）。
def _presign_endpoint(s: Settings) -> str | None:
    """署名付き URL を作る側が使うエンドポイント（Issue #268）。

    署名にはホスト名が含まれるので、**ブラウザが実際に読みに行くホストで署名する**必要がある。
    ローカルの Docker 構成では API の接続先は `http://minio:9000`（コンテナ間の名前）だが、
    ブラウザからは引けない。ブラウザ向けの `S3_PUBLIC_URL_BASE` の origin
    （`http://localhost:9000` 等）で署名すれば、URL を後から置換せずに済む。
    エンドポイント未指定（本番の AWS）では接続先とブラウザ向けが同じなので何もしない。
    """
    endpoint = s.S3_ENDPOINT_URL.strip()
    if not endpoint:
        return None
    parts = urlsplit(s.S3_PUBLIC_URL_BASE.strip())
    if not parts.scheme or not parts.netloc:
        return endpoint
    return f"{parts.scheme}://{parts.netloc}"


def _client_kwargs(s: Settings, *, for_presign: bool = False) -> dict[str, Any]:
    """設定から `boto3.client("s3", ...)` に渡す引数を組み立てる（純粋関数。Issue #166）。

    ローカル（MinIO）と本番（AWS の S3）で変わるのは次の 3 点:

    - **エンドポイント**: MinIO は `http://localhost:9000` などを指定する。
      本番は空にして `None` を渡し、AWS の標準のエンドポイントを使う。
    - **認証情報**: MinIO はアクセスキーを渡す。本番はキーを空にして両方 `None` を
      渡す。boto3 は「既定の認証情報チェーン」を探し、ECS の上ではタスクロールの
      一時的な認証情報を自動で使う（アクセスキーをどこにも置かずに済む）。
      片方だけ空は設定ミスなのでエラーにする。
    - **URL の形式**: MinIO を `http://localhost:9000` で動かしていると、バケット名を
      ホスト名に含める形（virtual-hosted）は名前解決できない。そのためエンドポイントを
      指定したときだけ `path` 形式（`http://localhost:9000/<バケット名>/<キー>`）にする。
      AWS の S3 では path 形式は非推奨なので、既定の形式に任せる。
    """
    endpoint = (_presign_endpoint(s) if for_presign else s.S3_ENDPOINT_URL.strip()) or None
    key_id = s.S3_ACCESS_KEY_ID.strip()
    secret = s.S3_SECRET_ACCESS_KEY.strip()
    if bool(key_id) != bool(secret):
        raise ValueError(
            "S3_ACCESS_KEY_ID と S3_SECRET_ACCESS_KEY は、両方を設定するか両方を空にしてください"
        )
    return {
        "endpoint_url": endpoint,
        "region_name": s.S3_REGION.strip() or None,
        "aws_access_key_id": key_id or None,
        "aws_secret_access_key": secret or None,
        "config": Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"} if endpoint else {},
            # 一時的なネットワークエラーは boto3 側で数回リトライさせる。
            retries={"max_attempts": 3, "mode": "standard"},
            # 1 回の接続・読み取りの待ち時間の上限（botocore の既定値に頼らず明示する）。
            # 画像 1 枚の PUT はリトライ込みでも数分で終わる。アップロード途中の
            # pending 行の寿命（UPLOAD_PENDING_TTL_SECONDS）はこれより十分長くしておく
            # （Issue #71。アカウント削除の遅延削除と PUT 後の自己点検が前提にしている）。
            connect_timeout=10,
            read_timeout=60,
        ),
    }


@functools.lru_cache(maxsize=1)
def get_s3_client() -> Any:
    """設定から S3 クライアントを組み立てる（プロセス内で 1 つを使い回す）。

    引数の組み立て（ローカルと本番の違い）は `_client_kwargs` を参照。
    """
    return boto3.client("s3", **_client_kwargs(settings))


@functools.lru_cache(maxsize=1)
def get_presign_client() -> Any:
    """署名付き URL の生成専用クライアント（通信はしない。Issue #268）。

    接続用と違うのは endpoint だけ（path 形式・リージョン・認証情報は `_client_kwargs` で揃う）。
    """
    return boto3.client("s3", **_client_kwargs(settings, for_presign=True))


# 画像を置くキーの接頭辞。**どちらに置くかで配信の経路が決まる**（Issue #185）。
#
# - PUBLIC_PREFIX（uploads/）… アバターだけ。公開読み取りを許すのはこの配下に限る。
#   本番は CloudFront（OAC）が uploads/* だけを配信する（infra/terraform/s3-images.tf）。
#   アバターは公開・非公開が切り替わらず、一覧で何度も表示されるので CDN が効く。
# - PRIVATE_PREFIX（private/）… レシピのサムネ・手順画像・感想画像。**公開読み取りを
#   一切許さない**ので、CloudFront 経由でも 403 になる。表示は期限付きの署名付き URL
#   （presigned_url）で行う。レシピの公開・非公開が切り替わってもキーは動かさない。
PUBLIC_PREFIX = "uploads/"
PRIVATE_PREFIX = "private/"


def _public_read_policy() -> str:
    """`uploads/` 配下だけを匿名で GET 可能にするバケットポリシー。

    **なぜ公開にするのか**: 画像はユーザーの端末が直接取りに行くもので、
    アプリから見えなければ意味がない。`uploads/` に置くのは**アバターだけ**で、
    「公開バケット ＋ 推測不能なランダムキー」方式を採っている（Issue #39）。
    キーは `uploads/<uuid4>.<ext>` なので URL を総当たりで当てることはできない。

    **`private/` は絶対にここに含めない**（Issue #185）。レシピのサムネ・手順画像・
    感想画像は `private/` に置き、公開読み取りを許さずに署名付き URL で配信する。

    **これはローカル（MinIO）と結合テスト用**。本番（AWS）のバケットは非公開で、
    画像は CloudFront（OAC）経由で `uploads/*` だけを配信する（infra/terraform の
    s3-images.tf / cloudfront.tf。Issue #165・#166）。本番ではこのポリシーを付けない
    （`ensure_bucket()` が production では何もしない）。

    `Resource` をバケット全体ではなく `uploads/*` に絞っているのは、将来
    別用途のオブジェクト（バックアップ等）を同じバケットに置いても
    巻き込んで公開しないため。
    """
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{settings.S3_BUCKET}/{PUBLIC_PREFIX}*"],
                }
            ],
        }
    )


def ensure_bucket() -> None:
    """バケットが無ければ作り、`uploads/` を公開読み取りにする（冪等）。

    ローカル開発と結合テスト用。MinIO は起動直後バケットが 1 つも無く、
    しかも作ったバケットは既定で非公開なので、そのままだと画像 URL が
    403 になる。毎回手で設定せずに済むようにここでまとめて面倒を見る。

    **production では何もしない**（Issue #166）。本番のバケットは Terraform が用意し、
    CloudFront（OAC）経由でだけ読めるよう非公開にしている。ここで公開ポリシーを
    付けると、その前提が崩れる。起動時（app/main.py）も production では呼ばないが、
    ほかの場所から誤って呼ばれたときの保険としてここでも止める。
    """
    if settings.APP_ENV == "production":
        logger.warning(
            "production では ensure_bucket を実行しない"
            "（本番のバケットは Terraform が用意し、公開しない）"
        )
        return

    client = get_s3_client()
    exists = True
    try:
        client.head_bucket(Bucket=settings.S3_BUCKET)
    except ClientError as exc:
        # 404 = 無い、なら作る。それ以外（権限エラー等）はそのまま投げる。
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status == 403:
            # 権限が無くて head できないだけで、バケット自体はある可能性が高い。
            logger.warning("head_bucket で 403。バケットの作成と設定はスキップする")
            return
        if status != 404:
            raise
        exists = False

    if not exists:
        client.create_bucket(Bucket=settings.S3_BUCKET)

    client.put_bucket_policy(Bucket=settings.S3_BUCKET, Policy=_public_read_policy())


def put_object(key: str, data: bytes, content_type: str) -> None:
    """オブジェクトを保存する。

    この呼び出しは外部 I/O なので **DB トランザクションの外**で行う
    （processing-model.md §2。ロックを持ったまま外部を待たない）。
    """
    get_s3_client().put_object(
        Bucket=settings.S3_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )


def presigned_url(key: str, expires_in: int) -> str:
    """オブジェクトを取得できる、**期限付きの署名付き URL** を作る（Issue #185）。

    `private/` 配下の画像は公開読み取りを許していないため、安定 URL では取得
    できない。代わりに、この URL を API のレスポンスに入れて返す。

    ## 通信は発生しない

    署名は手元で計算するだけなので、S3 / MinIO への往復は無い（レスポンスを
    組み立てるたびに呼んでも、外部 I/O は増えない）。

    ## 有効期限の上限は「署名に使った認証情報の寿命」

    `expires_in` を長くしても、**署名に使った一時認証情報が失効すると URL も
    無効になる**。本番は ECS のタスクロール（一時認証情報）で署名するため、
    `IMAGE_URL_TTL_SECONDS` は保守的な値にしてある（app/config.py）。

    署名専用の `get_presign_client()` を使う。endpoint 以外（path 形式・リージョン・
    認証情報）は接続用と同じ `_client_kwargs` で作るので設定はずれない。endpoint だけは
    ブラウザから届くホスト（`S3_PUBLIC_URL_BASE` の origin）にする（Issue #268）。
    """
    url = get_presign_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )
    return str(url)


def delete_object(key: str) -> None:
    """オブジェクトを削除する。**既に存在しない場合も成功として扱う**。

    削除キュー（`pending_storage_deletions`）は同じキーの重複登録を許す
    設計なので、2 回目以降の削除は「もう無い」になる。これをエラーに
    すると削除ジョブが永久に再試行してしまうため、成功扱いにする。
    S3 の DELETE はもともと存在しないキーでも 204 を返す仕様だが、
    実装差で 404 を返す互換ストレージもあるので明示的に握りつぶす。
    """
    try:
        get_s3_client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status == 404:
            return
        raise


def object_exists(key: str) -> bool:
    """オブジェクトの有無を返す（テストと運用調査用）。"""
    try:
        get_s3_client().head_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status in (403, 404):
            return False
        raise
    return True
