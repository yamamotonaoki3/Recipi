"""リクエストから値を取り出す小さなヘルパー（複数のモジュールで共有する）。"""

from __future__ import annotations

from starlette.requests import Request


def client_ip(request: Request) -> str:
    """呼び出し元の IP アドレス（レート制限のキー・アクセスログ・監査ログで使う）。

    既知の限界（暫定仕様・todo #16 / Issue #166）: リバースプロキシ /
    ロードバランサ配下で動かす場合、`request.client.host` はプロキシ自身の
    アドレスになり、全ユーザーが同じ IP として扱われてしまう。本番の
    プロキシ構成（AWS の API Gateway / ロードバランサ等）が決まったら、
    信頼するプロキシの範囲に限って `X-Forwarded-For` を読むよう、この関数
    1 か所を直す（Issue #166）。IP を使う箇所はすべてこの関数を通すこと。
    """
    return request.client.host if request.client is not None else "unknown"
