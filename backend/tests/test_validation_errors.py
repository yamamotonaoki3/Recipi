"""共通 RequestValidationError のメッセージと詳細の契約。"""

from __future__ import annotations

import json
from typing import Any, cast

import pytest
from fastapi import Request
from fastapi.exceptions import RequestValidationError

from app.main import handle_validation_error


def _response(errors: list[dict[str, object]]) -> dict[str, Any]:
    request = Request({"type": "http", "method": "POST", "path": "/api/v1/test", "headers": []})
    response = handle_validation_error(request, RequestValidationError(errors))
    return cast(dict[str, Any], json.loads(bytes(response.body).decode()))


def test_validation_details_are_localized_and_secret_input_is_redacted() -> None:
    body = _response(
        [
            {
                "type": "string_too_short",
                "loc": ("body", "password"),
                "msg": "String should have at least 8 characters",
                "input": "super-secret-password",
                "ctx": {"min_length": 8},
                "url": "https://errors.pydantic.dev/2.13/v/string_too_short",
            }
        ]
    )

    assert body["error"]["message"] == "リクエストの内容が不正です"
    error = body["error"]["details"]["errors"][0]
    assert error == {
        "loc": ["body", "password"],
        "msg": "パスワードは8文字以上で入力してください",
        "type": "string_too_short",
    }
    serialized = json.dumps(body, ensure_ascii=False)
    assert "super-secret-password" not in serialized
    assert "errors.pydantic.dev" not in serialized


def test_custom_japanese_message_is_preserved_without_pydantic_prefix() -> None:
    body = _response(
        [
            {
                "type": "value_error",
                "loc": ("body", "securityAnswer"),
                "msg": "Value error, 秘密の質問の回答は空白のみにできません",
                "input": "   ",
                "ctx": {"error": ValueError("秘密の質問の回答は空白のみにできません")},
            }
        ]
    )

    assert body["error"]["details"]["errors"] == [
        {
            "loc": ["body", "securityAnswer"],
            "msg": "秘密の質問の回答は空白のみにできません",
            "type": "value_error",
        }
    ]


def test_query_and_path_validation_keep_locations_and_get_contextual_messages() -> None:
    body = _response(
        [
            {
                "type": "greater_than_equal",
                "loc": ("query", "limit"),
                "msg": "Input should be greater than or equal to 1",
                "input": 0,
                "ctx": {"ge": 1},
            },
            {
                "type": "uuid_parsing",
                "loc": ("path", "recipe_id"),
                "msg": "Input should be a valid UUID",
                "input": "not-a-uuid",
                "ctx": {"error": "invalid UUID"},
            },
        ]
    )

    assert body["error"]["details"]["errors"] == [
        {
            "loc": ["query", "limit"],
            "msg": "件数は1以上で指定してください",
            "type": "greater_than_equal",
        },
        {
            "loc": ["path", "recipe_id"],
            "msg": "レシピIDの形式が不正です",
            "type": "uuid_parsing",
        },
    ]


@pytest.mark.parametrize(
    ("error_type", "field", "msg", "ctx", "expected"),
    [
        (
            "missing",
            "email",
            "Field required",
            {},
            "メールアドレスを入力してください",
        ),
        (
            "value_error",
            "email",
            "value is not a valid email address",
            {},
            "有効なメールアドレスを入力してください",
        ),
        (
            "string_too_long",
            "displayName",
            "String should have at most 30 characters",
            {"max_length": 30},
            "表示名は30文字以内で入力してください",
        ),
        (
            "too_short",
            "ingredientGroups",
            "List should have at least 1 item after validation, not 0",
            {"min_length": 1},
            "材料グループは1件以上指定してください",
        ),
        (
            "bool_parsing",
            "rememberMe",
            "Input should be a valid boolean",
            {},
            "ログイン状態の保持は真偽値で指定してください",
        ),
    ],
)
def test_common_validation_message_categories(
    error_type: str,
    field: str,
    msg: str,
    ctx: dict[str, object],
    expected: str,
) -> None:
    body = _response(
        [
            {
                "type": error_type,
                "loc": ("body", field),
                "msg": msg,
                "input": "sensitive",
                "ctx": ctx,
            }
        ]
    )

    assert body["error"]["details"]["errors"][0]["msg"] == expected
