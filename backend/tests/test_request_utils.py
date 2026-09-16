"""app/request_utils.py の client_ip() の単体テスト（DB 不要。Issue #166）。

IP はドキュメント用に予約された範囲（RFC 5737 の 192.0.2.0/24・198.51.100.0/24・
203.0.113.0/24、RFC 3849 の 2001:db8::/32）と、プライベートアドレスだけを使う。
"""

from __future__ import annotations

import pytest
from starlette.requests import Request

from app.config import settings
from app.request_utils import CLIENT_IP_HEADER, client_ip

TRUSTED_CIDRS = "10.20.10.0/24,10.20.11.0/24"  # VPC Link の ENI が置かれる private サブネット
VPC_LINK_IP = "10.20.10.25"
CLIENT = "203.0.113.7"


def _request(peer: str | None, headers: dict[str, str] | None = None) -> Request:
    """接続元とヘッダーを指定して、Starlette の Request を組み立てる。"""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (peer, 12345) if peer is not None else None,
    }
    return Request(scope)


@pytest.fixture
def trusted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", TRUSTED_CIDRS)


def test_uses_header_from_trusted_proxy(trusted: None):
    request = _request(VPC_LINK_IP, {CLIENT_IP_HEADER: CLIENT})
    assert client_ip(request) == CLIENT


def test_ignores_header_from_untrusted_peer(trusted: None):
    """信頼しない接続元が送ってきた専用ヘッダーは偽装かもしれないので無視する。"""
    request = _request("198.51.100.9", {CLIENT_IP_HEADER: CLIENT})
    assert client_ip(request) == "198.51.100.9"


def test_ignores_header_when_no_trusted_cidrs(monkeypatch: pytest.MonkeyPatch):
    """開発・テスト（TRUSTED_PROXY_CIDRS が空）では常に接続元を使う。"""
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", "")
    request = _request(VPC_LINK_IP, {CLIENT_IP_HEADER: CLIENT})
    assert client_ip(request) == VPC_LINK_IP


@pytest.mark.parametrize("value", [None, "", "not-an-ip", "203.0.113.7, 10.0.0.1"])
def test_falls_back_to_peer_when_header_missing_or_invalid(trusted: None, value: str | None):
    headers = {CLIENT_IP_HEADER: value} if value is not None else {}
    request = _request(VPC_LINK_IP, headers)
    assert client_ip(request) == VPC_LINK_IP


def test_does_not_use_x_forwarded_for(trusted: None):
    """X-Forwarded-For は並び方が経路に依存し、左側を偽装できるので使わない。"""
    request = _request(VPC_LINK_IP, {"X-Forwarded-For": "192.0.2.1, 203.0.113.7"})
    assert client_ip(request) == VPC_LINK_IP


def test_accepts_ipv6_client(trusted: None):
    request = _request(VPC_LINK_IP, {CLIENT_IP_HEADER: "2001:db8::1"})
    assert client_ip(request) == "2001:db8::1"


def test_non_ip_peer_is_not_trusted(trusted: None):
    """TestClient の接続元（"testclient"）のような IP でない値は信頼しない。"""
    request = _request("testclient", {CLIENT_IP_HEADER: CLIENT})
    assert client_ip(request) == "testclient"


def test_unknown_when_no_client():
    assert client_ip(_request(None)) == "unknown"
