from typing import Any, Mapping

from app.core.rbac import (
    ROLE_SUPER_FOUNDER,
    ROLE_SUB_LEADER,
    ROLE_SUB_MEMBER,
    LEGACY_ROLE_FOUNDER,
    LEGACY_ROLE_OWNER,
    LEGACY_ROLE_CO_OWNER,
    LEGACY_ROLE_MEMBER,
    WorkspaceRole,
    WorkspacePermission,
    SUPER_FOUNDER_PERMISSIONS,
    SUB_LEADER_PERMISSIONS,
    SUB_MEMBER_PERMISSIONS,
    PERMISSION_VIEW_WORKSPACE,
    PERMISSION_MANAGE_MEMBERS,
    PERMISSION_REMOVE_MEMBERS,
    PERMISSION_ASSIGN_LEADERS,
    PERMISSION_MANAGE_AI,
    PERMISSION_ACCESS_MEMORY,
    PERMISSION_ACCESS_SOURCES,
    PERMISSION_CREATE_SUBSPACE,
    PERMISSION_DELETE_WORKSPACE,
)

class OrganizationalAccessAuthority:
    """
    The single source of truth for workspace authorization and scoped permissions.
    """

    @classmethod
    def normalize_role(
        cls, 
        role: str | None, 
        workspace_type: str = "super_workspace"
    ) -> WorkspaceRole:
        """
        Maps legacy database roles to the new canonical roles based on the workspace context.
        """
        raw_role = str(role or "").strip().lower().replace("-", "_")

        # Map legacy roles based on the workspace hierarchy
        is_root = workspace_type in {"super_workspace", "workspace"}
        
        if raw_role in {LEGACY_ROLE_FOUNDER, LEGACY_ROLE_OWNER, ROLE_SUPER_FOUNDER}:
            return ROLE_SUPER_FOUNDER if is_root else ROLE_SUB_LEADER

        if raw_role in {LEGACY_ROLE_CO_OWNER, ROLE_SUB_LEADER}:
            return ROLE_SUPER_FOUNDER if is_root else ROLE_SUB_LEADER

        if raw_role in {LEGACY_ROLE_MEMBER, ROLE_SUB_MEMBER}:
            return ROLE_SUB_MEMBER

        # Default fallback
        return ROLE_SUB_MEMBER

    @classmethod
    def _get_permissions(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> set[WorkspacePermission]:
        canonical_role = cls.normalize_role(role, workspace_type)
        if canonical_role == ROLE_SUPER_FOUNDER:
            return SUPER_FOUNDER_PERMISSIONS
        if canonical_role == ROLE_SUB_LEADER:
            return SUB_LEADER_PERMISSIONS
        return SUB_MEMBER_PERMISSIONS

    @classmethod
    def has_permission(
        cls, 
        role: WorkspaceRole, 
        permission: WorkspacePermission,
        workspace_type: str = "super_workspace"
    ) -> bool:
        """Checks if a normalized role has a specific permission."""
        return permission in cls._get_permissions(role, workspace_type)

    @classmethod
    def can_view_workspace(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_VIEW_WORKSPACE, workspace_type)

    @classmethod
    def can_manage_workspace(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        # Derived from ability to manage members and AI in a scoped environment
        return cls.has_permission(role, PERMISSION_MANAGE_MEMBERS, workspace_type)

    @classmethod
    def can_manage_members(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_MANAGE_MEMBERS, workspace_type)

    @classmethod
    def can_remove_members(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_REMOVE_MEMBERS, workspace_type)

    @classmethod
    def can_assign_leaders(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_ASSIGN_LEADERS, workspace_type)

    @classmethod
    def can_manage_ai(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_MANAGE_AI, workspace_type)

    @classmethod
    def can_access_memory(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_ACCESS_MEMORY, workspace_type)

    @classmethod
    def can_access_sources(cls, role: WorkspaceRole, workspace_type: str = "super_workspace") -> bool:
        return cls.has_permission(role, PERMISSION_ACCESS_SOURCES, workspace_type)

    @classmethod
    def resolve_visible_workspaces(
        cls, 
        user_memberships: list[dict[str, Any]], 
        super_workspace_id: str
    ) -> set[str]:
        """
        Returns a set of workspace IDs that the user is explicitly authorized to view.
        Because sub-workspaces are PRIVATE BY DEFAULT, being a member of the super 
        workspace does NOT grant visibility into all sub-workspaces.
        """
        visible_ids = set()
        for membership in user_memberships:
            # The user explicitly has a membership in this workspace, so they can view it.
            # Assuming 'workspace_id' is provided in the membership dictionary.
            workspace_id = membership.get("workspace_id")
            if workspace_id:
                visible_ids.add(str(workspace_id))
        
        return visible_ids

    @classmethod
    def filter_visible_workspaces(
        cls, 
        workspaces: list[dict[str, Any]], 
        user_memberships: list[dict[str, Any]],
        super_founder_workspace_ids: set[str] = None
    ) -> list[dict[str, Any]]:
        """
        Filters a list of workspaces, returning only those the user is authorized to see.
        """
        super_founder_workspace_ids = super_founder_workspace_ids or set()
        user_workspace_ids = {str(m.get("workspace_id")) for m in user_memberships if m.get("workspace_id")}
        
        visible_workspaces = []
        for workspace in workspaces:
            wid = str(workspace.get("id"))
            parent_id = str(workspace.get("parent_workspace_id")) if workspace.get("parent_workspace_id") else None
            is_global = workspace.get("is_global")

            # Super Founders see all their sub-workspaces
            if parent_id and parent_id in super_founder_workspace_ids:
                visible_workspaces.append(workspace)
                continue

            # Global spaces under a super workspace are visible if the user has access to the super workspace
            if is_global and parent_id and parent_id in user_workspace_ids:
                visible_workspaces.append(workspace)
                continue

            # Direct membership grants visibility
            if wid in user_workspace_ids:
                visible_workspaces.append(workspace)
                continue
                
        return visible_workspaces
