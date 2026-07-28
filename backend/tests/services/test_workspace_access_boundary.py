from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException

from app.services import workspace_access_service, workspace_service
from app.services.supabase_service import SupabaseServiceError

SERVICES_DIR = Path(__file__).resolve().parents[2] / "app" / "services"
ACCESS_EXPORTS = {
    "_select_workspace_record",
    "active_workspace_id_from_request",
    "can_manage_workspace_resource",
    "require_active_workspace_access",
    "require_workspace_access",
    "require_workspace_management_access",
    "resolve_workspace_access",
}
DOMAIN_EXPORTS = ACCESS_EXPORTS | {
    "WorkspaceAccess",
    "get_profiles",
    "list_workspace_members",
    "membership_source_workspace",
    "normalize_intelligence_preferences",
    "normalize_operational_label",
    "normalize_workspace_record",
    "utc_now_iso",
}


def test_workspace_service_keeps_one_access_implementation() -> None:
    for name in ACCESS_EXPORTS:
        assert getattr(workspace_service, name) is getattr(workspace_access_service, name)


def test_workspace_domain_services_use_narrow_owners() -> None:
    offenders: list[str] = []

    for path in sorted(SERVICES_DIR.glob("*.py")):
        if path.name == "workspace_service.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            if not (node.module or "").endswith("workspace_service"):
                continue
            coupled_names = sorted(alias.name for alias in node.names if alias.name in DOMAIN_EXPORTS)
            if coupled_names:
                offenders.append(f"{path.name}:{node.lineno}:{','.join(coupled_names)}")

    assert offenders == []


@pytest.mark.asyncio
async def test_membership_lookup_failure_is_sanitized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        del columns
        if table == "workspaces":
            assert filters == {"id": "workspace-1"}
            return {
                "id": "workspace-1",
                "user_id": "owner-1",
                "name": "Private workspace",
                "workspace_type": "workspace",
                "parent_workspace_id": None,
                "is_global": False,
            }
        assert table == "workspace_members"
        assert filters == {"workspace_id": "workspace-1", "user_id": "member-1"}
        raise SupabaseServiceError("database credentials and internal query details")

    monkeypatch.setattr(
        workspace_access_service,
        "select_one_trusted",
        fake_select_one_trusted,
    )

    with pytest.raises(HTTPException) as exc_info:
        await workspace_access_service.require_workspace_access(
            "workspace-1",
            "member-1",
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Internal server error"
