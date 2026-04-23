from typing import Literal, Final

# Canonical Roles
ROLE_SUPER_FOUNDER: Final = "super_founder"
ROLE_SUB_LEADER: Final = "sub_leader"
ROLE_SUB_MEMBER: Final = "sub_member"

# Legacy mappings for backward compatibility during transition
LEGACY_ROLE_OWNER: Final = "owner"
LEGACY_ROLE_CO_OWNER: Final = "co_owner"
LEGACY_ROLE_MEMBER: Final = "member"
LEGACY_ROLE_FOUNDER: Final = "founder"

WorkspaceRole = Literal[
    "super_founder",
    "sub_leader",
    "sub_member",
    "founder",
    "owner",
    "co_owner",
    "member",
]

# Canonical Permissions
PERMISSION_VIEW_WORKSPACE: Final = "view_workspace"
PERMISSION_MANAGE_MEMBERS: Final = "manage_members"
PERMISSION_REMOVE_MEMBERS: Final = "remove_members"
PERMISSION_ASSIGN_LEADERS: Final = "assign_leaders"
PERMISSION_MANAGE_AI: Final = "manage_ai"
PERMISSION_ACCESS_MEMORY: Final = "access_memory"
PERMISSION_ACCESS_SOURCES: Final = "access_sources"
PERMISSION_CREATE_SUBSPACE: Final = "create_subspace"
PERMISSION_DELETE_WORKSPACE: Final = "delete_workspace"

WorkspacePermission = Literal[
    "view_workspace",
    "manage_members",
    "remove_members",
    "assign_leaders",
    "manage_ai",
    "access_memory",
    "access_sources",
    "create_subspace",
    "delete_workspace",
]

# Role-to-Permission Mappings
# Super Founder: Global Organizational Authority
SUPER_FOUNDER_PERMISSIONS: set[WorkspacePermission] = {
    PERMISSION_VIEW_WORKSPACE,
    PERMISSION_MANAGE_MEMBERS,
    PERMISSION_REMOVE_MEMBERS,
    PERMISSION_ASSIGN_LEADERS,
    PERMISSION_MANAGE_AI,
    PERMISSION_ACCESS_MEMORY,
    PERMISSION_ACCESS_SOURCES,
    PERMISSION_CREATE_SUBSPACE,
    PERMISSION_DELETE_WORKSPACE,
}

# Sub-workspace Leader: Scoped Operational Authority
SUB_LEADER_PERMISSIONS: set[WorkspacePermission] = {
    PERMISSION_VIEW_WORKSPACE,
    PERMISSION_MANAGE_MEMBERS,  # Can add existing org members
    PERMISSION_MANAGE_AI,
    PERMISSION_ACCESS_MEMORY,
    PERMISSION_ACCESS_SOURCES,
}

# Sub-workspace Member: Restricted Operational Access
SUB_MEMBER_PERMISSIONS: set[WorkspacePermission] = {
    PERMISSION_VIEW_WORKSPACE,
    PERMISSION_ACCESS_MEMORY,
    PERMISSION_ACCESS_SOURCES,
}
