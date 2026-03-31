from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any, NoReturn

from starlette.concurrency import run_in_threadpool

from ..db.supabase_client import get_supabase

logger = logging.getLogger(__name__)
INTERNAL_DB_ERROR = "Internal server error"
SUPABASE_AUTH_ERROR = (
    "Supabase rejected the backend API key. Verify backend/.env "
    "SUPABASE_SERVICE_ROLE_KEY belongs to the configured SUPABASE_URL project."
)
SUPABASE_NETWORK_ERROR = (
    "Supabase is unreachable. Verify SUPABASE_URL, DNS/network access, and that "
    "the Supabase project is available."
)


class SupabaseServiceError(RuntimeError):
    pass


def _is_supabase_auth_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "invalid api key" in message or (
        "401" in message and ("api key" in message or "service_role" in message)
    )


def _is_supabase_network_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "connecterror",
            "nodename nor servname",
            "name or service not known",
            "temporary failure in name resolution",
            "network is unreachable",
        )
    )


def _raise_supabase_error(operation: str, table: str, exc: Exception) -> NoReturn:
    if _is_supabase_auth_error(exc):
        logger.error(
            "%s on '%s' failed: %s | raw_error=%r",
            operation,
            table,
            SUPABASE_AUTH_ERROR,
            exc,
        )
        raise SupabaseServiceError(SUPABASE_AUTH_ERROR) from exc

    if _is_supabase_network_error(exc):
        logger.warning(
            "%s on '%s' failed: %s | raw_error=%r",
            operation,
            table,
            SUPABASE_NETWORK_ERROR,
            exc,
        )
        raise SupabaseServiceError(SUPABASE_NETWORK_ERROR) from exc

    logger.exception(
        "Supabase operation failed | operation=%s | table=%s | raw_error=%r",
        operation,
        table,
        exc,
    )

    raise SupabaseServiceError(INTERNAL_DB_ERROR) from exc

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


def _insert_one_trusted_sync(table: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    response = get_supabase().table(table).insert(dict(payload)).execute()
    data = getattr(response, "data", None) or []
    if not data:
        logger.error("Trusted insert into '%s' returned no rows.", table)
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


def _insert_many_trusted_sync(table: str, payloads: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    response = get_supabase().table(table).insert([dict(p) for p in payloads]).execute()
    data = getattr(response, "data", None) or []
    if not data:
        logger.error("Trusted batch insert into '%s' returned no rows.", table)
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

    # Build base query
    query = get_supabase().table(table).select(columns)
    query = _apply_filters(query, filters)

    if order_by:
        query = query.order(order_by, desc=desc)
    if limit is not None:
        query = query.limit(limit)
    if offset is not None:
        query = query.offset(offset)

    try:
        response = query.execute()
        return list(getattr(response, "data", None) or [])
    except Exception as exc:
        msg = str(exc)
        # Detect missing column errors and retry with that column removed from selection
        if "does not exist" in msg and isinstance(columns, str):
            import re

            m = re.search(r"column\s+([^\s]+)\s+does not exist", msg)
            if m:
                missing = m.group(1)
                # handle qualified name like table.column
                missing_col = missing.split(".")[-1]
                # Split columns by comma if present, otherwise treat as single entry
                cols_raw = [c.strip() for c in columns.split(",")] if "," in columns else [columns.strip()]
                cols = [c for c in cols_raw if c and c != missing_col and c != f"{table}.{missing_col}"]
                if cols:
                    new_columns = ",".join(cols)
                    logger.warning("Retrying select on %s without missing column '%s'", table, missing_col)
                    query = get_supabase().table(table).select(new_columns)
                    query = _apply_filters(query, filters)
                    if order_by:
                        query = query.order(order_by, desc=desc)
                    if limit is not None:
                        query = query.limit(limit)
                    if offset is not None:
                        query = query.offset(offset)
                    response = query.execute()
                    return list(getattr(response, "data", None) or [])
                else:
                    # No usable columns left after removing missing column; try selecting all
                    logger.warning("No columns left after removing missing column '%s' on %s; retrying select *", missing_col, table)
                    query = get_supabase().table(table).select("*")
                    query = _apply_filters(query, filters)
                    if order_by:
                        query = query.order(order_by, desc=desc)
                    if limit is not None:
                        query = query.limit(limit)
                    if offset is not None:
                        query = query.offset(offset)
                    response = query.execute()
                    return list(getattr(response, "data", None) or [])
        # If we couldn't handle it, re-raise
        raise


def _select_all_trusted_sync(
    table: str,
    columns: str,
    filters: Mapping[str, Any] | None = None,
    order_by: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict[str, Any]]:
    query = get_supabase().table(table).select(columns)
    query = _apply_filters(query, filters)

    if order_by:
        query = query.order(order_by, desc=desc)
    if limit is not None:
        query = query.limit(limit)
    if offset is not None:
        query = query.offset(offset)

    try:
        response = query.execute()
        return list(getattr(response, "data", None) or [])
    except Exception as exc:
        msg = str(exc)
        if "does not exist" in msg and isinstance(columns, str):
            import re

            m = re.search(r"column\s+([^\s]+)\s+does not exist", msg)
            if m:
                missing = m.group(1)
                missing_col = missing.split(".")[-1]
                cols_raw = [c.strip() for c in columns.split(",")] if "," in columns else [columns.strip()]
                cols = [c for c in cols_raw if c and c != missing_col and c != f"{table}.{missing_col}"]
                if cols:
                    new_columns = ",".join(cols)
                    logger.warning("Retrying trusted select on %s without missing column '%s'", table, missing_col)
                    query = get_supabase().table(table).select(new_columns)
                    query = _apply_filters(query, filters)
                    if order_by:
                        query = query.order(order_by, desc=desc)
                    if limit is not None:
                        query = query.limit(limit)
                    if offset is not None:
                        query = query.offset(offset)
                    response = query.execute()
                    return list(getattr(response, "data", None) or [])
                else:
                    logger.warning("No columns left after removing missing column '%s' on %s; retrying select *", missing_col, table)
                    query = get_supabase().table(table).select("*")
                    query = _apply_filters(query, filters)
                    if order_by:
                        query = query.order(order_by, desc=desc)
                    if limit is not None:
                        query = query.limit(limit)
                    if offset is not None:
                        query = query.offset(offset)
                    response = query.execute()
                    return list(getattr(response, "data", None) or [])
        raise


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
    try:
        response = query.limit(1).maybe_single().execute()
        return getattr(response, "data", None)
    except Exception as exc:
        msg = str(exc)
        if "does not exist" in msg and isinstance(columns, str):
            import re

            m = re.search(r"column\s+([^\s]+)\s+does not exist", msg)
            if m:
                missing = m.group(1)
                missing_col = missing.split(".")[-1]
                cols_raw = [c.strip() for c in columns.split(",")] if "," in columns else [columns.strip()]
                cols = [c for c in cols_raw if c and c != missing_col and c != f"{table}.{missing_col}"]
                if cols:
                    new_columns = ",".join(cols)
                    logger.warning("Retrying select on %s without missing column '%s'", table, missing_col)
                    query = get_supabase().table(table).select(new_columns)
                    query = _apply_filters(query, filters)
                    response = query.limit(1).maybe_single().execute()
                    return getattr(response, "data", None)
                else:
                    logger.warning("No columns left after removing missing column '%s' on %s; retrying select *", missing_col, table)
                    query = get_supabase().table(table).select("*")
                    query = _apply_filters(query, filters)
                    response = query.limit(1).maybe_single().execute()
                    return getattr(response, "data", None)
        raise


def _select_one_trusted_sync(
    table: str,
    columns: str,
    filters: Mapping[str, Any],
) -> dict[str, Any] | None:
    query = get_supabase().table(table).select(columns)
    query = _apply_filters(query, filters)
    try:
        response = query.limit(1).maybe_single().execute()
        return getattr(response, "data", None)
    except Exception as exc:
        msg = str(exc)
        if "does not exist" in msg and isinstance(columns, str) and "," in columns:
            import re

            m = re.search(r"column\s+([^\s]+)\s+does not exist", msg)
            if m:
                missing = m.group(1)
                missing_col = missing.split(".")[-1]
                cols = [c.strip() for c in columns.split(",") if c.strip() and c.strip() != missing_col and c.strip() != f"{table}.{missing_col}"]
                if cols:
                    new_columns = ",".join(cols)
                    logger.warning("Retrying trusted select on %s without missing column '%s'", table, missing_col)
                    query = get_supabase().table(table).select(new_columns)
                    query = _apply_filters(query, filters)
                    response = query.limit(1).maybe_single().execute()
                    return getattr(response, "data", None)
        raise


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


def _update_one_trusted_sync(
    table: str,
    filters: Mapping[str, Any],
    payload: Mapping[str, Any],
) -> dict[str, Any] | None:
    if not payload:
        logger.error("Trusted update for '%s' requires at least one field.", table)
        raise SupabaseServiceError(INTERNAL_DB_ERROR)

    query = get_supabase().table(table).update(dict(payload))
    query = _apply_filters(query, filters)
    response = query.execute()
    data = getattr(response, "data", None) or []
    if not data:
        return None
    return data[0]


def _delete_many_trusted_sync(
    table: str,
    filters: Mapping[str, Any],
) -> list[dict[str, Any]]:
    query = get_supabase().table(table).delete()
    query = _apply_filters(query, filters)
    response = query.execute()
    return list(getattr(response, "data", None) or [])


async def insert_one(table: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    try:
        return await run_in_threadpool(_insert_one_sync, table, payload)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Insert", table, exc)


async def insert_one_trusted(table: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    try:
        return await run_in_threadpool(_insert_one_trusted_sync, table, payload)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Trusted insert", table, exc)


async def insert_many(table: str, payloads: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    try:
        return await run_in_threadpool(_insert_many_sync, table, payloads)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Batch insert", table, exc)


async def insert_many_trusted(table: str, payloads: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    try:
        return await run_in_threadpool(_insert_many_trusted_sync, table, payloads)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Trusted batch insert", table, exc)


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
        _raise_supabase_error("Query", table, exc)


async def select_all_trusted(
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
            _select_all_trusted_sync,
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
        msg = str(exc)
        if "does not exist" in msg:
            logger.warning("Trusted query on '%s' failed due to missing column: %s. Returning empty list.", table, msg)
            return []
        _raise_supabase_error("Trusted query", table, exc)


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
        _raise_supabase_error("Query", table, exc)


async def select_one_trusted(
    table: str,
    columns: str,
    filters: Mapping[str, Any],
) -> dict[str, Any] | None:
    try:
        return await run_in_threadpool(_select_one_trusted_sync, table, columns, filters)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        # Make missing-column errors non-fatal for trusted reads so transient schema drift
        # doesn't cause 500s. Higher-level callers should handle None results.
        msg = str(exc)
        if "does not exist" in msg:
            logger.warning("Trusted query on '%s' failed due to missing column: %s. Returning None.", table, msg)
            return None
        _raise_supabase_error("Trusted query", table, exc)


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
        _raise_supabase_error("Update", table, exc)


async def update_one_trusted(
    table: str,
    filters: Mapping[str, Any],
    payload: Mapping[str, Any],
) -> dict[str, Any] | None:
    try:
        return await run_in_threadpool(_update_one_trusted_sync, table, filters, payload)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Trusted update", table, exc)


async def upsert_one(table: str, payload: Mapping[str, Any], on_conflict: str) -> dict[str, Any]:
    try:
        return await run_in_threadpool(_upsert_one_sync, table, payload, on_conflict)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Upsert", table, exc)


async def delete_many_trusted(
    table: str,
    filters: Mapping[str, Any],
) -> list[dict[str, Any]]:
    try:
        return await run_in_threadpool(_delete_many_trusted_sync, table, filters)
    except SupabaseServiceError:
        raise
    except Exception as exc:
        _raise_supabase_error("Trusted delete", table, exc)
