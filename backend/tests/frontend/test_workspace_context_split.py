from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_ROOT = REPO_ROOT / "frontend"
WORKSPACE_CONTEXT = FRONTEND_ROOT / "lib" / "workspace-provider.tsx"


def read_frontend(relative_path: str) -> str:
    return (FRONTEND_ROOT / relative_path).read_text(encoding="utf-8")


def test_workspace_provider_exposes_split_contexts() -> None:
    source = WORKSPACE_CONTEXT.read_text(encoding="utf-8")
    context_values = read_frontend("lib/workspace-context-values.ts")

    assert "useWorkspaceContextValues" in source
    assert "useMemo<WorkspaceTreeContextValue>" in context_values
    assert "useMemo<WorkspaceMembershipContextValue>" in context_values
    assert "useMemo<WorkspaceIntelligenceContextValue>" in context_values
    assert "<WorkspaceTreeContext.Provider value={treeValue}>" in source
    assert "<WorkspaceMembershipContext.Provider value={membershipValue}>" in source
    assert "<WorkspaceIntelligenceContext.Provider value={intelligenceValue}>" in source
    assert "...treeValue" in context_values
    assert "...membershipValue" in context_values
    assert "...intelligenceValue" in context_values
    assert "export function useWorkspace()" in source


def test_workspace_context_modules_have_guarded_hooks() -> None:
    modules = {
        "lib/workspace-tree-context.tsx": ("WorkspaceTreeContext", "WorkspaceTreeContextValue", "useWorkspaceTree"),
        "lib/workspace-membership-context.tsx": (
            "WorkspaceMembershipContext",
            "WorkspaceMembershipContextValue",
            "useWorkspaceMembership",
        ),
        "lib/workspace-intelligence-context.tsx": (
            "WorkspaceIntelligenceContext",
            "WorkspaceIntelligenceContextValue",
            "useWorkspaceIntelligence",
        ),
    }

    for relative_path, (context_name, type_name, hook_name) in modules.items():
        source = read_frontend(relative_path)

        assert f"createContext<{type_name} | undefined>(undefined)" in source
        assert f"export const {context_name}" in source
        assert f"export function {hook_name}()" in source
        assert f"{hook_name} must be used within WorkspaceProvider" in source


def test_workspace_provider_delegates_storage_and_destructive_confirmation() -> None:
    provider = WORKSPACE_CONTEXT.read_text(encoding="utf-8")
    storage = read_frontend("lib/workspace-active-storage.ts")
    active_selection = read_frontend("lib/workspace-active-selection.ts")
    confirmation = read_frontend("lib/workspace-destructive-confirmation.tsx")
    effects = read_frontend("lib/workspace-provider-effects.ts")

    assert "useActiveWorkspaceSelection" in provider
    assert "readStoredActiveWorkspaceId" in provider
    assert "WorkspaceDestructiveConfirmationModal" in provider
    assert "useWorkspaceDestructiveConfirmation" in provider
    assert "usePendingWorkspaceInvitePolling" in provider
    assert "useActiveWorkspaceReconciliation" in provider
    assert 'from "@/components/ui/Button"' not in provider
    assert 'from "@/components/ui/Modal"' not in provider
    assert "export function persistActiveWorkspaceId" in storage
    assert "export function readStoredActiveWorkspaceId" in storage
    assert "export function useActiveWorkspaceSelection" in active_selection
    assert "persistActiveWorkspaceId" in active_selection
    assert "setApiWorkspaceId" in active_selection
    assert "persistActiveWorkspaceId" not in provider
    assert "setApiWorkspaceId" not in provider
    assert "export function useWorkspaceDestructiveConfirmation" in confirmation
    assert "export function WorkspaceDestructiveConfirmationModal" in confirmation
    assert "export function usePendingWorkspaceInvitePolling" in effects
    assert "export function useActiveWorkspaceReconciliation" in effects
    assert len(provider.splitlines()) <= 1_000


def test_workspace_switch_clears_scoped_api_and_query_state() -> None:
    provider = WORKSPACE_CONTEXT.read_text(encoding="utf-8")
    active_selection = read_frontend("lib/workspace-active-selection.ts")
    api = read_frontend("lib/api.ts")

    assert 'import { invalidateQueries } from "./query";' in active_selection
    assert "replaceActiveWorkspace(null, { forceInvalidate: true });" in provider
    assert "invalidateQueries();" in active_selection
    assert "export function getApiWorkspaceId()" in api
    assert "const apiWorkspaceChangeListeners = new Set<() => void>();" in api
    assert "subscribeApiWorkspaceChange(() =>" in api
    assert "this.inFlightGets.clear();" in api


def test_upload_uses_api_workspace_state_instead_of_legacy_storage() -> None:
    upload = read_frontend("components/upload/UploadDropzone.tsx")

    assert 'import { apiUrl, getApiWorkspaceId } from "@/lib/api";' in upload
    assert "getApiWorkspaceId()" in upload
    assert "X-Omnix-Workspace" in upload
    assert 'localStorage.getItem("omnix.activeWorkspaceId")' not in upload


def test_low_scope_consumers_use_targeted_workspace_hooks() -> None:
    consumers = {
        "lib/conversation-history-context.tsx": "useWorkspaceTree",
        "lib/workspace-notifications-context.tsx": "useWorkspaceTree",
        "lib/workspace-continuity-context.tsx": "useWorkspaceTree",
        "components/layout/WorkspaceSearch.tsx": "useWorkspaceTree",
        "components/workspace/IntelligenceDashboard.tsx": "useWorkspaceTree",
        "components/decisions/CreateDecisionModal.tsx": "useWorkspaceMembership",
        "components/workspace/InviteNotifications.tsx": "useWorkspaceMembership",
    }

    for relative_path, hook_name in consumers.items():
        source = read_frontend(relative_path)

        assert hook_name in source
        assert "useWorkspace()" not in source
