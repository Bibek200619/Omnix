"use client";

import { Activity, Clock, Eye, Radio, Users } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { cn } from "@/lib/utils";
import type { WorkspacePresenceMember, WorkspacePresenceSnapshot } from "@/lib/workspace-types";

type WorkspacePresenceClusterProps = {
  presence: WorkspacePresenceSnapshot | null;
  workspaceName?: string | null;
  currentUserId?: string | null;
  compact?: boolean;
  className?: string;
};

function memberName(member: WorkspacePresenceMember) {
  return member.full_name || member.email || member.handle || "Workspace member";
}

function viewLabel(member: WorkspacePresenceMember, workspaceName?: string | null) {
  if (member.current_label) return member.current_label;
  if (workspaceName) return workspaceName;
  return "this workspace";
}

export function WorkspacePresenceCluster({
  presence,
  workspaceName,
  currentUserId,
  compact = false,
  className,
}: WorkspacePresenceClusterProps) {
  const onlineMembers = (presence?.online_members ?? []).filter((member) => member.user_id !== currentUserId);
  const recentlyActive = (presence?.recently_active_members ?? []).filter((member) => member.user_id !== currentUserId);
  const visibleMembers = (onlineMembers.length ? onlineMembers : recentlyActive).slice(0, compact ? 4 : 5);
  const onlineCount = presence?.online_count ?? 0;
  const recentCount = presence?.recently_active_count ?? 0;
  const activeViewer = onlineMembers[0] ?? recentlyActive[0] ?? null;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[12px] border border-cyan-300/14 bg-[linear-gradient(135deg,rgba(0,255,255,0.08),rgba(10,18,32,0.82)_42%,rgba(0,232,122,0.05))] shadow-[var(--omnix-glow-xs)]",
        compact ? "px-3 py-2.5" : "p-4",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.7),transparent)]" />
      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">
            <Radio className="h-3 w-3 text-[var(--omnix-green)]" />
            Live presence
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--omnix-green)] shadow-[0_0_10px_var(--omnix-green)]" />
            <p className="truncate text-sm font-semibold text-white">
              {onlineCount ? `${onlineCount} online` : recentCount ? `${recentCount} recently active` : "Quiet workspace"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          {visibleMembers.length ? visibleMembers.map((member, index) => (
            <div key={member.user_id} className={cn("relative", index > 0 && "-ml-2")}>
              <ProfileAvatar
                name={memberName(member)}
                email={member.email}
                handle={member.handle}
                avatarUrl={member.avatar_url}
                className="h-8 w-8 rounded-lg border border-cyan-200/25 bg-cyan-300/10 text-xs font-semibold shadow-[0_0_18px_rgba(0,255,255,0.2)]"
              />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[#06101d]",
                  member.is_online ? "bg-[var(--omnix-green)] shadow-[0_0_8px_var(--omnix-green)]" : "bg-[var(--omnix-amber)]",
                )}
              />
            </div>
          )) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--omnix-border)] bg-black/20 text-[var(--omnix-text-3)]">
              <Users className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>

      {!compact ? (
        <div className="relative z-10 mt-4 grid gap-2">
          <div className="flex items-center gap-2 rounded-[9px] border border-white/[0.06] bg-black/16 px-3 py-2 text-xs text-[var(--omnix-text-2)]">
            <Eye className="h-3.5 w-3.5 text-cyan-200" />
            <span className="min-w-0 flex-1 truncate">
              {activeViewer
                ? `${memberName(activeViewer)} is viewing ${viewLabel(activeViewer, workspaceName)}`
                : "No active viewers in this workspace right now"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-[9px] border border-white/[0.06] bg-black/16 px-3 py-2 text-xs text-[var(--omnix-text-2)]">
              <Activity className="h-3.5 w-3.5 text-emerald-200" />
              <span>{presence?.active_count ?? 0} active in {workspaceName || "workspace"}</span>
            </div>
            <div className="flex items-center gap-2 rounded-[9px] border border-white/[0.06] bg-black/16 px-3 py-2 text-xs text-[var(--omnix-text-2)]">
              <Clock className="h-3.5 w-3.5 text-amber-200" />
              <span>{recentCount} recently active</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
