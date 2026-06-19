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
        "relative overflow-hidden rounded-[12px] border border-cyan-300/14 bg-[linear-gradient(135deg,var(--omnix-rgba-0-255-255-0-12),var(--omnix-rgba-10-18-32-0-85)_42%,var(--omnix-rgba-0-232-122-0-06))] shadow-[var(--omnix-glow-xs)] backdrop-blur-md",
        compact ? "px-3 py-2.5" : "p-4",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--omnix-rgba-0-255-255-0-7),transparent)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-[linear-gradient(180deg,transparent,var(--omnix-rgba-0-255-255-0-2),transparent)]" />
      
      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200/60">
            <Radio className={cn("h-3 w-3", onlineCount > 0 && "animate-pulse text-[var(--omnix-green)]")} />
            Scoped Pulse
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              onlineCount > 0 
                ? "bg-[var(--omnix-green)] shadow-[0_0_12px_var(--omnix-green)] animate-pulse" 
                : recentCount > 0 
                ? "bg-[var(--omnix-amber)]" 
                : "bg-white/20"
            )} />
            <p className="truncate text-sm font-bold tracking-tight text-white">
              {onlineCount ? `${onlineCount} member${onlineCount === 1 ? '' : 's'} live` : recentCount ? `${recentCount} recently active` : "Scoped space quiet"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center -space-x-2">
          {visibleMembers.length ? visibleMembers.map((member) => (
            <div key={member.user_id} className="group relative transition-transform duration-500 hover:z-20 hover:scale-105">
              <ProfileAvatar
                name={memberName(member)}
                email={member.email}
                handle={member.handle}
                avatarUrl={member.avatar_url}
                className={cn(
                  "h-8 w-8 rounded-lg border bg-black/40 text-xs font-medium transition-all duration-500",
                  member.is_online 
                    ? "border-cyan-400/20 shadow-[0_0_8px_var(--omnix-rgba-34-211-238-0-15)] ring-1 ring-cyan-400/10" 
                    : "border-white/5"
                )}
              />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--omnix-color-06101d)]",
                  member.is_online 
                    ? "bg-[var(--omnix-green)] shadow-[0_0_4px_var(--omnix-green)]" 
                    : "bg-[var(--omnix-amber)]",
                )}
              />
              <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 backdrop-blur-sm border border-white/10">
                {memberName(member)}
              </div>
            </div>
          )) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-white/30">
              <Users className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>

      {!compact ? (
        <div className="relative z-10 mt-4 space-y-2">
          <div className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-cyan-50/70 transition-colors hover:bg-white/[0.05]">
            <Eye className="h-3.5 w-3.5 text-cyan-300/80" />
            <span className="min-w-0 flex-1 truncate">
              {activeViewer
                ? <><span className="font-medium text-white">{memberName(activeViewer)}</span> is active in <span className="text-cyan-200/80">{viewLabel(activeViewer, workspaceName)}</span></>
                : "You are currently connected to this workspace"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] font-medium text-emerald-50/70 transition-colors hover:bg-white/[0.04]">
              <Activity className="h-3.5 w-3.5 text-emerald-400/80" />
              <span>{presence?.active_count ?? 0} active now</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] font-medium text-amber-50/70 transition-colors hover:bg-white/[0.04]">
              <Clock className="h-3.5 w-3.5 text-amber-400/80" />
              <span>{recentCount} in last 30m</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
