"""リクエストから値を取り出す小さなヘルパー（複数のモジュールで共有する）。"""

from __future__ import annotations

import ipaddress

from starlette.requests import Request

from app.config import settings

# API Gateway がクライアントの IP を入れて付ける専用ヘッダー（Issue #166）。
# infra/terraform/apigateway.tf のパラメータマッピングで、`$context.identity.sourceIp`
# （API Gateway が見た送信元の IP）を「上書き」で入れている。上書きなので、
# クライアントが同じ名前のヘッダーを送ってきても置き換わり、偽装できない。
CLIENT_IP_HEADER = "X-Recipi-Client-Ip"


def client_ip(request: Request) -> str:
    """呼び出し元の IP アドレス（レート制限のキー・アクセスログ・監査ログで使う）。

    IP を使う箇所はすべてこの関数を通すこと（1 か所で直せるように）。

    本番（AWS）では、リクエストは API Gateway → VPC Link → ECS の順に届くので、
    `request.client.host`（直接の接続元）は VPC Link の ENI の IP になり、
    全員が同じ IP に見えてしまう。そこで:

    1. 接続元が `TRUSTED_PROXY_CIDRS`（VPC Link の ENI が置かれる private サブネット）の
       中なら、API Gateway が付けた `X-Recipi-Client-Ip` を使う。
    2. それ以外（ローカル開発・テスト・信頼しない接続元）からの `X-Recipi-Client-Ip` は
       無視する。誰でも送れるヘッダーなので、信頼する経路から来たときだけ信じる。
    3. ヘッダーが無い・IP として解釈できないときは、接続元の IP を使う。

    `X-Forwarded-For` は使わない: 並び方（上書きか追記か）が経路に依存し、左側は
    クライアントが好きに書けるため。

    利用者が企業のプロキシや CDN の後ろにいる場合は、そのプロキシの IP になる
    （API Gateway が見た送信元の IP だから）。
    """
    if request.client is None:
        return "unknown"
    peer = request.client.host
    if _is_trusted_proxy(peer):
        forwarded = _parse_ip(request.headers.get(CLIENT_IP_HEADER))
        if forwarded is not None:
            return forwarded
    return peer


def _is_trusted_proxy(peer: str) -> bool:
    """接続元の IP が、信頼する範囲（TRUSTED_PROXY_CIDRS）に入っているか。"""
    networks = settings.trusted_proxy_networks
    if not networks:
        return False
    address = _parse_ip(peer)
    if address is None:
        return False  # "testclient" のような IP でない値は信頼しない
    ip = ipaddress.ip_address(address)
    # IPv4 と IPv6 を混ぜて比べても例外にはならず、False になるだけ。
    return any(ip in network for network in networks)


def _parse_ip(value: str | None) -> str | None:
    """正しい IP アドレスなら正規化した文字列を、そうでなければ None を返す。"""
    if value is None:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None
