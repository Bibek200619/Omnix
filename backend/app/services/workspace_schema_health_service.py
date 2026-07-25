from __future__ import annotations

import inspect
import logging
from typing import Any

from ..db.supabase_client import get_async_supabase

logger = logging.getLogger(__name__)

SCHEMA_HEALTH_RPC = "omnix_workspace_schema_health"


EXPECTED_WORKSPACE_SCHEMA: dict[str, dict[str, Any]] = {
    "workspace_channels": {
        "columns": {
            "id",
            "workspace_id",
            "created_by",
            "name",
            "slug",
            "purpose",
            "channel_type",
            "visibility",
            "posting_policy",
            "is_archived",
            "message_count",
            "last_message_preview",
            "last_message_at",
            "created_at",
            "updated_at",
        },
        "foreign_keys": [
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"created_by"}, "references_table": "users"},
        ],
        "rls": True,
    },
    "workspace_channel_members": {
        "columns": {"channel_id", "user_id", "role", "created_at"},
        "foreign_keys": [
            {"columns": {"channel_id"}, "references_table": "workspace_channels"},
            {"columns": {"user_id"}, "references_table": "users"},
        ],
        "rls": True,
    },
    "workspace_channel_messages": {
        "columns": {
            "id",
            "workspace_id",
            "channel_id",
            "author_user_id",
            "parent_message_id",
            "content",
            "context_links",
            "metadata",
            "client_nonce",
            "created_at",
            "updated_at",
            "edited_at",
        },
        "foreign_keys": [
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"channel_id"}, "references_table": "workspace_channels"},
            {"columns": {"author_user_id"}, "references_table": "users"},
            {"columns": {"parent_message_id"}, "references_table": "workspace_channel_messages"},
        ],
        "rls": True,
    },
    "workspace_tasks": {
        "columns": {
            "id",
            "workspace_id",
            "title",
            "description",
            "status",
            "owner_user_id",
            "created_by",
            "due_date",
            "blockers",
            "linked_context",
            "activity_metadata",
            "momentum_metadata",
            "initiative_id",
            "client_nonce",
            "completed_at",
            "created_at",
            "updated_at",
        },
        "foreign_keys": [
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"owner_user_id"}, "references_table": "users"},
            {"columns": {"created_by"}, "references_table": "users"},
            {"columns": {"initiative_id"}, "references_table": "workspace_initiatives"},
        ],
        "rls": True,
    },
    "workspace_initiatives": {
        "columns": {
            "id",
            "workspace_id",
            "name",
            "title",
            "description",
            "status",
            "owner_user_id",
            "created_by",
            "target_date",
            "initiative_context",
            "linked_resources",
            "activity_metadata",
            "client_nonce",
            "completed_at",
            "created_at",
            "updated_at",
        },
        "foreign_keys": [
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"owner_user_id"}, "references_table": "users"},
            {"columns": {"created_by"}, "references_table": "users"},
        ],
        "rls": True,
    },
    "workspace_initiative_channels": {
        "columns": {"initiative_id", "workspace_id", "channel_id", "attached_by", "created_at"},
        "foreign_keys": [
            {"columns": {"initiative_id"}, "references_table": "workspace_initiatives"},
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"channel_id"}, "references_table": "workspace_channels"},
            {"columns": {"attached_by"}, "references_table": "users"},
        ],
        "rls": True,
    },
    "workspace_connectors": {
        "columns": {
            "id",
            "workspace_id",
            "user_id",
            "connector_type",
            "display_name",
            "status",
            "config",
            "last_error",
            "job_id",
            "source_file_id",
            "last_synced_at",
            "created_at",
            "updated_at",
        },
        "foreign_keys": [
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"user_id"}, "references_table": "users"},
            {"columns": {"job_id"}, "references_table": "jobs"},
            {"columns": {"source_file_id"}, "references_table": "files"},
        ],
        "rls": True,
    },
    "workspace_decisions": {
        "columns": {
            "id",
            "workspace_id",
            "title",
            "description",
            "decision_reason",
            "status",
            "source_type",
            "source_id",
            "source_message_id",
            "source_channel_id",
            "source_evidence",
            "initiative_id",
            "created_by",
            "created_at",
            "updated_at",
        },
        "foreign_keys": [
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
            {"columns": {"source_message_id"}, "references_table": "workspace_channel_messages"},
            {"columns": {"source_channel_id"}, "references_table": "workspace_channels"},
            {"columns": {"initiative_id"}, "references_table": "workspace_initiatives"},
            {"columns": {"created_by"}, "references_table": "users"},
        ],
        "rls": True,
    },
    "workspace_decision_tasks": {
        "columns": {"decision_id", "task_id", "workspace_id", "linked_at"},
        "foreign_keys": [
            {"columns": {"decision_id"}, "references_table": "workspace_decisions"},
            {"columns": {"task_id"}, "references_table": "workspace_tasks"},
            {"columns": {"workspace_id"}, "references_table": "workspaces"},
        ],
        "rls": True,
    },
}


class SchemaHealthError(RuntimeError):
    pass


def _table_lookup(metadata: dict[str, Any]) -> dict[str, dict[str, Any]]:
    tables = metadata.get("tables")
    if not isinstance(tables, list):
        raise SchemaHealthError("Schema health metadata did not include a table list.")
    return {str(table.get("name")): table for table in tables if isinstance(table, dict) and table.get("name")}


def _actual_columns(table: dict[str, Any]) -> set[str]:
    columns = table.get("columns")
    return {str(column) for column in columns} if isinstance(columns, list) else set()


def _actual_policies(table: dict[str, Any]) -> list[dict[str, Any]]:
    policies = table.get("policies")
    return [policy for policy in policies if isinstance(policy, dict)] if isinstance(policies, list) else []


def _has_select_policy(table: dict[str, Any]) -> bool:
    for policy in _actual_policies(table):
        command = str(policy.get("command") or "").upper()
        if command in {"SELECT", "ALL"}:
            return True
    return False


def _has_foreign_key(table: dict[str, Any], expected: dict[str, Any]) -> bool:
    foreign_keys = table.get("foreign_keys")
    if not isinstance(foreign_keys, list):
        return False
    expected_columns = {str(column) for column in expected["columns"]}
    expected_reference = str(expected["references_table"])
    for foreign_key in foreign_keys:
        if not isinstance(foreign_key, dict):
            continue
        actual_columns = {
            str(column)
            for column in foreign_key.get("columns", [])
            if column is not None
        }
        references_table = str(foreign_key.get("references_table") or "")
        if expected_columns == actual_columns and references_table == expected_reference:
            return True
    return False


def evaluate_workspace_schema_health(metadata: dict[str, Any]) -> dict[str, Any]:
    table_metadata = _table_lookup(metadata)
    diagnostics: dict[str, Any] = {
        "missing_tables": [],
        "missing_columns": {},
        "missing_foreign_keys": {},
        "rls_disabled_tables": [],
        "missing_select_policies": [],
    }
    table_results: dict[str, Any] = {}

    for table_name, expectation in EXPECTED_WORKSPACE_SCHEMA.items():
        actual = table_metadata.get(table_name)
        if not actual or actual.get("exists") is False:
            diagnostics["missing_tables"].append(table_name)
            table_results[table_name] = {"status": "missing"}
            continue

        expected_columns = set(expectation["columns"])
        missing_columns = sorted(expected_columns - _actual_columns(actual))
        if missing_columns:
            diagnostics["missing_columns"][table_name] = missing_columns

        missing_foreign_keys = [
            {
                "columns": sorted(expected["columns"]),
                "references_table": expected["references_table"],
            }
            for expected in expectation["foreign_keys"]
            if not _has_foreign_key(actual, expected)
        ]
        if missing_foreign_keys:
            diagnostics["missing_foreign_keys"][table_name] = missing_foreign_keys

        if expectation.get("rls") and not bool(actual.get("rls_enabled")):
            diagnostics["rls_disabled_tables"].append(table_name)

        if expectation.get("rls") and not _has_select_policy(actual):
            diagnostics["missing_select_policies"].append(table_name)

        table_results[table_name] = {
            "status": "healthy"
            if not missing_columns
            and not missing_foreign_keys
            and (not expectation.get("rls") or (bool(actual.get("rls_enabled")) and _has_select_policy(actual)))
            else "unhealthy",
            "column_count": len(_actual_columns(actual)),
            "foreign_key_count": len(actual.get("foreign_keys") or []),
            "rls_enabled": bool(actual.get("rls_enabled")),
            "policy_count": len(_actual_policies(actual)),
        }

    failures = sum(
        len(value) if isinstance(value, list) else len(value.keys())
        for value in diagnostics.values()
    )
    status = "healthy" if failures == 0 else "unhealthy"
    return {
        "status": status,
        "summary": "Workspace schema matches Omnix platform expectations."
        if status == "healthy"
        else "Workspace schema drift detected. Apply the latest migrations before trusting workspace flows.",
        "diagnostics": diagnostics,
        "tables": table_results,
        "metadata_generated_at": metadata.get("generated_at"),
    }


async def fetch_workspace_schema_metadata() -> dict[str, Any]:
    try:
        client = await get_async_supabase()
        if inspect.isawaitable(client):
            client = await client
        response = await client.rpc(SCHEMA_HEALTH_RPC, {}).execute()
    except Exception as exc:
        logger.exception("Workspace schema health RPC failed.")
        raise SchemaHealthError(
            f"Unable to run {SCHEMA_HEALTH_RPC}. Apply the latest migrations and verify Supabase metadata access."
        ) from exc

    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return data
    raise SchemaHealthError(f"{SCHEMA_HEALTH_RPC} returned invalid metadata.")


async def check_workspace_schema_health() -> dict[str, Any]:
    try:
        metadata = await fetch_workspace_schema_metadata()
        return evaluate_workspace_schema_health(metadata)
    except SchemaHealthError as exc:
        return {
            "status": "degraded",
            "summary": "Workspace schema health could not be verified.",
            "diagnostics": {"metadata_error": str(exc), "required_rpc": SCHEMA_HEALTH_RPC},
            "tables": {},
        }
