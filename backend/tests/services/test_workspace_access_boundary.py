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
async def test_denied_workspace_access_does_not_hydrate_broad_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, object]] = []

    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        events.append((table, (columns, filters)))
        if table == "workspaces":
            assert columns == workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS
            return {
                "id": "workspace-1",
                "user_id": "owner-1",
                "parent_workspace_id": None,
                "workspace_type": "workspace",
                "is_global": False,
            }
        assert table == "workspace_members"
        return None

    monkeypatch.setattr(
        workspace_access_service,
        "select_one_trusted",
        fake_select_one_trusted,
    )

    access = await workspace_access_service.resolve_workspace_access(
        "workspace-1",
        "outsider-1",
    )

    assert access is None
    assert events == [
        (
            "workspaces",
            (
                workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS,
                {"id": "workspace-1"},
            ),
        ),
        (
            "workspace_members",
            (
                workspace_access_service.WORKSPACE_MEMBER_COLUMNS,
                {"workspace_id": "workspace-1", "user_id": "outsider-1"},
            ),
        ),
    ]


@pytest.mark.asyncio
async def test_authorized_workspace_hydrates_after_membership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, object]] = []

    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        events.append((table, (columns, filters)))
        if table == "workspace_members":
            return {
                "workspace_id": "workspace-1",
                "user_id": "member-1",
                "role": "member",
            }
        if columns == workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS:
            return {
                "id": "workspace-1",
                "user_id": "owner-1",
                "parent_workspace_id": None,
                "workspace_type": "workspace",
                "is_global": False,
            }
        assert columns == workspace_access_service.WORKSPACE_COLUMNS
        return {
            "id": "workspace-1",
            "user_id": "owner-1",
            "name": "Private workspace",
            "parent_workspace_id": None,
            "workspace_type": "workspace",
            "is_global": False,
            "ai_instructions": "sensitive instructions",
        }

    monkeypatch.setattr(
        workspace_access_service,
        "select_one_trusted",
        fake_select_one_trusted,
    )

    access = await workspace_access_service.require_workspace_access(
        "workspace-1",
        "member-1",
    )

    assert access.workspace["ai_instructions"] == "sensitive instructions"
    assert events == [
        (
            "workspaces",
            (
                workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS,
                {"id": "workspace-1"},
            ),
        ),
        (
            "workspace_members",
            (
                workspace_access_service.WORKSPACE_MEMBER_COLUMNS,
                {"workspace_id": "workspace-1", "user_id": "member-1"},
            ),
        ),
        (
            "workspaces",
            (
                workspace_access_service.WORKSPACE_COLUMNS,
                {"id": "workspace-1"},
            ),
        ),
    ]


@pytest.mark.asyncio
async def test_workspace_access_fails_closed_when_authority_fields_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_reads = 0

    async def fake_select_one_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any] | None:
        nonlocal workspace_reads
        if table == "workspace_members":
            return {
                "workspace_id": "workspace-1",
                "user_id": "member-1",
                "role": "member",
            }
        workspace_reads += 1
        if columns == workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS:
            return {
                "id": "workspace-1",
                "user_id": "owner-1",
                "parent_workspace_id": None,
                "workspace_type": "workspace",
                "is_global": False,
            }
        return {
            "id": "workspace-1",
            "user_id": "new-owner-1",
            "name": "Changed workspace",
            "parent_workspace_id": None,
            "workspace_type": "workspace",
            "is_global": False,
        }

    monkeypatch.setattr(
        workspace_access_service,
        "select_one_trusted",
        fake_select_one_trusted,
    )

    access = await workspace_access_service.resolve_workspace_access(
        "workspace-1",
        "member-1",
    )

    assert access is None
    assert workspace_reads == 2


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
