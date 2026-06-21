from __future__ import annotations

from pathlib import Path

from app.services import workspace_common, workspace_membership_service, workspace_service

BACKEND_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_SERVICE = BACKEND_ROOT / "app" / "services" / "workspace_service.py"
WORKSPACE_COMMON = BACKEND_ROOT / "app" / "services" / "workspace_common.py"
WORKSPACE_MEMBERSHIP = BACKEND_ROOT / "app" / "services" / "workspace_membership_service.py"


def test_workspace_service_reexports_common_and_membership_contracts() -> None:
    assert workspace_service.WorkspaceAccess is workspace_common.WorkspaceAccess
    assert workspace_service.normalize_workspace_role is workspace_common.normalize_workspace_role
    assert workspace_service.get_profiles is workspace_membership_service.get_profiles
    assert workspace_service.list_workspace_members is workspace_membership_service.list_workspace_members
    assert workspace_service.assign_member_to_subspace is workspace_membership_service.assign_member_to_subspace


def test_workspace_service_stays_below_reviewable_size_threshold() -> None:
    assert len(WORKSPACE_SERVICE.read_text(encoding="utf-8").splitlines()) <= 900
    assert len(WORKSPACE_COMMON.read_text(encoding="utf-8").splitlines()) <= 220
    assert len(WORKSPACE_MEMBERSHIP.read_text(encoding="utf-8").splitlines()) <= 400
