from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_ROOT = REPO_ROOT / "frontend"
WORKSPACE_CONTEXT = FRONTEND_ROOT / "lib" / "workspace-provider.tsx"


def read_frontend(relative_path: str) -> str:
    return (FRONTEND_ROOT / relative_path).read_text(encoding="utf-8")


def test_workspace_provider_exposes_split_contexts() -> None:
    source = WORKSPACE_CONTEXT.read_text(encoding="utf-8")

    assert "useMemo<WorkspaceTreeContextValue>" in source
    assert "useMemo<WorkspaceMembershipContextValue>" in source
    assert "useMemo<WorkspaceIntelligenceContextValue>" in source
    assert "<WorkspaceTreeContext.Provider value={treeValue}>" in source
    assert "<WorkspaceMembershipContext.Provider value={membershipValue}>" in source
    assert "<WorkspaceIntelligenceContext.Provider value={intelligenceValue}>" in source
    assert "...treeValue" in source
    assert "...membershipValue" in source
    assert "...intelligenceValue" in source
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
