from __future__ import annotations

import pytest

from app.services.workspace_schema_health_service import (
    EXPECTED_WORKSPACE_SCHEMA,
    SchemaHealthError,
    check_workspace_schema_health,
    evaluate_workspace_schema_health,
)


def _metadata_for_expected_schema() -> dict[str, object]:
    tables = []
    for table_name, expectation in EXPECTED_WORKSPACE_SCHEMA.items():
        tables.append(
            {
                "name": table_name,
                "exists": True,
                "columns": sorted(expectation["columns"]),
                "foreign_keys": [
                    {
                        "columns": sorted(foreign_key["columns"]),
                        "references_table": foreign_key["references_table"],
                    }
                    for foreign_key in expectation["foreign_keys"]
                ],
                "rls_enabled": expectation["rls"],
                "policies": [{"name": f"{table_name}_select", "command": "SELECT", "roles": ["authenticated"]}],
            }
        )
    return {"generated_at": "2026-06-02T00:00:00+00:00", "tables": tables}


def test_schema_health_reports_healthy_expected_metadata() -> None:
    result = evaluate_workspace_schema_health(_metadata_for_expected_schema())

    assert result["status"] == "healthy"
    assert result["diagnostics"]["missing_tables"] == []


def test_schema_health_reports_schema_drift_diagnostics() -> None:
    metadata = _metadata_for_expected_schema()
    tables = metadata["tables"]
    assert isinstance(tables, list)
    task_table = next(table for table in tables if table["name"] == "workspace_tasks")
    task_table["columns"] = ["id", "workspace_id"]
    task_table["foreign_keys"] = []
    connector_table = next(table for table in tables if table["name"] == "workspace_connectors")
    connector_table["rls_enabled"] = False
    connector_table["policies"] = []

    result = evaluate_workspace_schema_health(metadata)

    assert result["status"] == "unhealthy"
    assert "workspace_tasks" in result["diagnostics"]["missing_columns"]
    assert "workspace_tasks" in result["diagnostics"]["missing_foreign_keys"]
    assert "workspace_connectors" in result["diagnostics"]["rls_disabled_tables"]
    assert "workspace_connectors" in result["diagnostics"]["missing_select_policies"]


@pytest.mark.asyncio
async def test_schema_health_reports_degraded_when_metadata_rpc_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_metadata() -> dict[str, object]:
        raise SchemaHealthError("metadata RPC is unavailable")

    monkeypatch.setattr(
        "app.services.workspace_schema_health_service.fetch_workspace_schema_metadata",
        broken_metadata,
    )

    result = await check_workspace_schema_health()

    assert result["status"] == "degraded"
    assert result["diagnostics"]["required_rpc"] == "omnix_workspace_schema_health"
