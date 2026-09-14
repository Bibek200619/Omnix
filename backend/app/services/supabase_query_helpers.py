from __future__ import annotations

from collections.abc import Mapping
import logging
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
