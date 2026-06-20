from __future__ import annotations

from collections.abc import Mapping
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def apply_filters(
    query: Any,
    filters: Mapping[str, Any] | None,
) -> Any:
    if not filters:
        return query

    for column, value in filters.items():
        if isinstance(value, (list, tuple, set)):
            query = query.in_(column, list(value))
        elif isinstance(value, dict):
            for op, val in value.items():
                if op == "lt":
                    query = query.lt(column, val)
                elif op == "gt":
                    query = query.gt(column, val)
                elif op == "lte":
                    query = query.lte(column, val)
                elif op == "gte":
                    query = query.gte(column, val)
                elif op == "eq":
                    query = query.eq(column, val)
                elif op == "neq":
                    query = query.neq(column, val)
                elif op == "ilike":
                    query = query.ilike(column, val)
                elif op == "is":
                    query = query.is_(column, val)
                else:
                    logger.warning("Unsupported filter operator encountered; using equality fallback.")
                    query = query.eq(column, val)
        else:
            query = query.eq(column, value)
    return query


def select_columns_after_missing_column(
    table: str,
    columns: str,
    error_message: str,
) -> tuple[str, str] | None:
    missing_col: str | None = None
    missing_column_match = re.search(
        r"column\s+['\"]?([A-Za-z0-9_.-]+)['\"]?\s+does not exist",
        error_message,
        re.IGNORECASE,
    )
    if missing_column_match is not None:
        missing_col = missing_column_match.group(1).split(".")[-1]

    if missing_col is None:
        schema_cache_match = re.search(
            rf"could not find\s+(?:the\s+)?['\"]?([A-Za-z0-9_.-]+)['\"]?\s+column\s+of\s+['\"]?{re.escape(table)}['\"]?\s+in\s+the\s+schema\s+cache",
            error_message,
            re.IGNORECASE,
        )
        if schema_cache_match is not None:
            missing_col = schema_cache_match.group(1).split(".")[-1]

    if missing_col is None:
        return None

    cols_raw = [c.strip() for c in columns.split(",")] if "," in columns else [columns.strip()]
    cols = [
        col
        for col in cols_raw
        if col and col != missing_col and col != f"{table}.{missing_col}"
    ]
    new_columns = ",".join(cols) if cols else "*"
    if new_columns == columns:
        return None
    return missing_col, new_columns


def select_recovery_attempts(columns: str) -> int:
    if columns == "*":
        return 1
    return max(1, len([col for col in columns.split(",") if col.strip()]) + 1)
