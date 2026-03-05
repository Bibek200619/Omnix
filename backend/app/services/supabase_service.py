from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

from starlette.concurrency import run_in_threadpool

from ..db.supabase import get_supabase

logger = logging.getLogger(__name__)
INTERNAL_DB_ERROR = "Internal server error"


class SupabaseServiceError(RuntimeError):
    pass


def _apply_filters(
    query: Any,
    filters: Mapping[str, Any] | None,
) -> Any:
    if not filters:
        return query

    for column, value in filters.items():
        if isinstance(value, (list, tuple, set)):
            query = query.in_(column, list(value))
        else:
            query = query.eq(column, value)
    return query


def _insert_one_sync(table: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    # WARNING: get_supabase() uses the SERVICE ROLE KEY. 
    # This bypasses RLS completely. Enforcing user_id mapping prevents privilege escalation.
    if "user_id" not in payload:
        logger.error("Rejected insert into '%s' without explicit user_id.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    response = get_supabase().table(table).insert(dict(payload)).execute()
    data = getattr(response, "data", None) or []
    if not data:
        logger.error("Insert into '%s' returned no rows.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)
    return data[0]


def _insert_many_sync(table: str, payloads: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    # WARNING: get_supabase() uses the SERVICE ROLE KEY. 
    # This bypasses RLS completely. Enforcing user_id mapping prevents privilege escalation.
    for payload in payloads:
        if "user_id" not in payload:
            logger.error("Rejected batch insert into '%s' without explicit user_id.", table)
            raise SupabaseServiceError(INTERNAL_DB_ERROR)

    response = get_supabase().table(table).insert([dict(p) for p in payloads]).execute()
    data = getattr(response, "data", None) or []
    if not data:
        logger.error("Batch insert into '%s' returned no rows.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)
    return data


def _upsert_one_sync(table: str, payload: Mapping[str, Any], on_conflict: str) -> dict[str, Any]:
    # WARNING: get_supabase() uses the SERVICE ROLE KEY. 
    # This bypasses RLS completely. Enforcing user_id mapping prevents privilege escalation.
    if "user_id" not in payload:
        logger.error("Rejected upsert into '%s' without explicit user_id.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    response = get_supabase().table(table).upsert(dict(payload), on_conflict=on_conflict).execute()
    data = getattr(response, "data", None) or []
    if not data:
        logger.error("Upsert into '%s' returned no rows.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)
    return data[0]


def _select_all_sync(
    table: str,
    columns: str,
    filters: Mapping[str, Any] | None = None,
    order_by: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict[str, Any]]:
    # WARNING: get_supabase() uses the SERVICE ROLE KEY. 
    # This bypasses RLS completely. Enforcing user_id filters prevents data leaks.
    if not filters or "user_id" not in filters:
        logger.error("Rejected read on table '%s' missing user_id filter.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    query = get_supabase().table(table).select(columns)
    query = _apply_filters(query, filters)

    if order_by:
        query = query.order(order_by, desc=desc)
    if limit is not None:
        query = query.limit(limit)
    if offset is not None:
        query = query.offset(offset)

    response = query.execute()
    return list(getattr(response, "data", None) or [])


def _select_one_sync(
    table: str,
    columns: str,
    filters: Mapping[str, Any],
) -> dict[str, Any] | None:
    # WARNING: get_supabase() uses the SERVICE ROLE KEY. 
    # This bypasses RLS completely. Enforcing user_id filters prevents data leaks.
    if not filters or "user_id" not in filters:
        logger.error("Rejected read on table '%s' missing user_id filter.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    query = get_supabase().table(table).select(columns)
    query = _apply_filters(query, filters)
    response = query.limit(1).maybe_single().execute()
    return getattr(response, "data", None)


def _update_one_sync(
    table: str,
    filters: Mapping[str, Any],
    payload: Mapping[str, Any],
) -> dict[str, Any] | None:
    # WARNING: get_supabase() uses the SERVICE ROLE KEY. 
    # This bypasses RLS completely. Enforcing user_id filters prevents unauthorized modifications.
    if not filters or "user_id" not in filters:
        logger.error("Rejected update on table '%s' missing user_id filter.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    if not payload:
        logger.error("Update for '%s' requires at least one field.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    query = get_supabase().table(table).update(dict(payload))
    query = _apply_filters(query, filters)
    response = query.execute()
    data = getattr(response, "data", None) or []
    if not data:
        return None
    return data[0]


async def insert_one(table: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    try:
        return await run_in_threadpool(_insert_one_sync, table, payload)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        logger.exception("Failed to insert into '%s'.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc


async def insert_many(table: str, payloads: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    try:
        return await run_in_threadpool(_insert_many_sync, table, payloads)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        logger.exception("Failed to batch insert into '%s'.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc


async def select_all(
    table: str,
    columns: str,
    filters: Mapping[str, Any] | None = None,
    order_by: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict[str, Any]]:
    try:
        return await run_in_threadpool(
            _select_all_sync,
            table,
            columns,
            filters,
            order_by,
            desc,
            limit,
            offset,
        )
    except SupabaseServiceError:
        raise
    except Exception as exc:
        logger.exception("Failed to query '%s'.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc


async def select_one(
    table: str,
    columns: str,
    filters: Mapping[str, Any],
) -> dict[str, Any] | None:
    try:
        return await run_in_threadpool(_select_one_sync, table, columns, filters)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        logger.exception("Failed to query '%s'.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc


async def update_one(
    table: str,
    filters: Mapping[str, Any],
    payload: Mapping[str, Any],
) -> dict[str, Any] | None:
    try:
        return await run_in_threadpool(_update_one_sync, table, filters, payload)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        logger.exception("Failed to update '%s'.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc


async def upsert_one(table: str, payload: Mapping[str, Any], on_conflict: str) -> dict[str, Any]:
    try:
        return await run_in_threadpool(_upsert_one_sync, table, payload, on_conflict)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        logger.exception("Failed to upsert into '%s'.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc
