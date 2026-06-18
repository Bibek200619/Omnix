"use client";

import type { WorkspaceMember } from "@/lib/workspace-types";
import type { WorkspacePresenceMember } from "@/lib/workspace-types";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { cn } from "@/lib/utils";
import { workspaceRoleAvatarClass } from "@/lib/workspace-roles";

type WorkspaceMemberStackProps = {
  members: WorkspaceMember[];
  totalCount?: number;
  size?: "sm" | "md";
  className?: string;
  presenceMembers?: WorkspacePresenceMember[];
  showPresence?: boolean;
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
  presenceMembers = [],
  showPresence = false,
}: WorkspaceMemberStackProps) {
  const visibleMembers = members.slice(0, 3);
  const overflowCount = Math.max((totalCount ?? members.length) - visibleMembers.length, 0);
  const presenceByUserId = new Map(presenceMembers.map((member) => [member.user_id, member]));

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex items-center">
        {visibleMembers.map((member, index) => {
          const presence = presenceByUserId.get(member.user_id);
          return (
            <span key={member.user_id} className={cn("relative", index > 0 && "-ml-2")}>
              <ProfileAvatar
                name={workspaceMemberName(member)}
                email={member.email}
                handle={member.handle}
                avatarUrl={member.avatar_url}
                className={cn(
                  "rounded-lg font-semibold shadow-[0_8px_18px_var(--omnix-rgba-rgba-0-0-0-0-22)]",
                  workspaceRoleAvatarClass(member.role),
                  sizeClasses[size],
                  showPresence && presence?.is_online && "ring-1 ring-emerald-300/55 shadow-[0_0_18px_var(--omnix-rgba-rgba-0-232-122-0-22)]",
                )}
              />
              {showPresence && presence ? (
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[var(--omnix-color-07111f)]",
                    presence.is_online
                      ? "bg-[var(--omnix-green)] shadow-[0_0_8px_var(--omnix-green)]"
                      : "bg-[var(--omnix-amber)]",
                  )}
                />
              ) : null}
            </span>
          );
        })}
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
