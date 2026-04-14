"use client";

import type { WorkspaceMember } from "@/lib/workspace-types";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { cn } from "@/lib/utils";
import { workspaceRoleAvatarClass } from "@/lib/workspace-roles";

type WorkspaceMemberStackProps = {
  members: WorkspaceMember[];
  totalCount?: number;
  size?: "sm" | "md";
  className?: string;
};

const sizeClasses = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-8 w-8 text-xs",
};

export function workspaceMemberName(member: WorkspaceMember) {
  return member.full_name || member.email || member.user_id;
}

export function WorkspaceMemberStack({
  members,
  totalCount,
  size = "sm",
  className,
}: WorkspaceMemberStackProps) {
  const visibleMembers = members.slice(0, 3);
  const overflowCount = Math.max((totalCount ?? members.length) - visibleMembers.length, 0);

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex items-center">
        {visibleMembers.map((member, index) => (
          <ProfileAvatar
            key={member.user_id}
            name={workspaceMemberName(member)}
            email={member.email}
            handle={member.handle}
            avatarUrl={member.avatar_url}
            className={cn(
              "rounded-lg font-semibold shadow-[0_8px_18px_rgba(0,0,0,0.22)]",
              workspaceRoleAvatarClass(member.role),
              sizeClasses[size],
              index > 0 && "-ml-2",
            )}
          />
        ))}
        {overflowCount > 0 ? (
          <div
            className={cn(
              "ml-2 flex items-center justify-center rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2 text-[var(--omnix-text-2)]",
              size === "sm" ? "h-7 text-[11px]" : "h-8 text-xs",
            )}
          >
            +{overflowCount}
          </div>
        ) : null}
      </div>
    </div>
  );
}
