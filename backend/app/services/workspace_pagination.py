from __future__ import annotations

import base64
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, status

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200


def normalize_page_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_PAGE_LIMIT
    return min(max(int(limit), 1), MAX_PAGE_LIMIT)


def encode_cursor(row: dict[str, Any]) -> str | None:
    row_id = str(row.get("id") or "")
    updated_at = row.get("updated_at")
    if isinstance(updated_at, (date, datetime)):
        updated_at = updated_at.isoformat()
    updated_at_value = str(updated_at or "")
    if not row_id or not updated_at_value:
        return None
    raw = f"{updated_at_value}:{row_id}"
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str | None) -> tuple[str, str] | None:
    if not cursor:
        return None
    try:
        raw = base64.b64decode(cursor.encode("ascii"), validate=True).decode("utf-8")
        updated_at, row_id = raw.rsplit(":", 1)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pagination cursor.",
        ) from exc
    if not updated_at or not row_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pagination cursor.",
        )
    return updated_at, row_id


def cursor_filters(base_filters: dict[str, Any], cursor: str | None) -> dict[str, Any]:
    filters = dict(base_filters)
    decoded = decode_cursor(cursor)
    if decoded is not None:
        updated_at, _row_id = decoded
        filters["updated_at"] = {"lt": updated_at}
    return filters


def cursor_page(items: list[dict[str, Any]], *, has_more: bool) -> dict[str, Any]:
    next_cursor = encode_cursor(items[-1]) if has_more and items else None
    return {
        "items": items,
        "next_cursor": next_cursor,
        "has_more": bool(has_more and next_cursor),
    }
