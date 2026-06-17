"use client";

import {
  BookOpen,
  ChevronRight,
  Database,
  FileSearch,
  Globe2,
  Hash,
  MoreVertical,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { SearchMode } from "@/components/chat/types";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { WorkspacePresenceCluster } from "@/components/workspace/WorkspacePresenceCluster";
import { cn } from "@/lib/utils";
import { workspaceRoleLabel } from "@/lib/workspace-roles";
import type {
  Workspace,
  WorkspaceIntelligenceProfile,
  WorkspaceLiveStatus,
  WorkspaceMember,
  WorkspacePresenceSnapshot,
} from "@/lib/workspace-types";

type ChatWorkspaceChromeProps = {
  activeLiveStatus: WorkspaceLiveStatus | null;
  activeWorkspace: Workspace | null;
  activeWorkspaceIntelligence: WorkspaceIntelligenceProfile | null;
  currentConversation: string | null;
  currentUserId?: string | null;
  historyOpen: boolean;
  onOpenHistory: () => void;
  presence: WorkspacePresenceSnapshot | null;
  searchMode: SearchMode;
  workspaceMembers: WorkspaceMember[];
};

export function ChatWorkspaceChrome({
  activeLiveStatus,
  activeWorkspace,
  activeWorkspaceIntelligence,
  currentConversation,
  currentUserId,
  historyOpen,
  onOpenHistory,
  presence,
  searchMode,
  workspaceMembers,
}: ChatWorkspaceChromeProps) {
  const statusItems = [
    {
      icon: FileSearch,
      label: "Workspace",
      value: activeWorkspace?.name ?? "Loading workspace",
      color: "text-cyan-200",
    },
    {
      icon: Database,
      label: "AI context",
      value: activeWorkspaceIntelligence
        ? `Using ${activeWorkspaceIntelligence.workspace_name} operational context`
        : activeWorkspace?.is_shared
        ? `Organizational memory scoped to ${activeWorkspace.member_count} members`
        : "Workspace-scoped retrieval active",
      color: "text-emerald-200",
    },
    {
      icon: Globe2,
      label: "Research",
      value:
        searchMode === "auto"
          ? "Auto hybrid"
          : searchMode === "workspace"
          ? "Workspace only"
          : searchMode === "web"
          ? "Live web"
          : "Workspace + web",
      color: "text-violet-200",
    },
    {
      icon: ShieldCheck,
      label: "Trust scope",
      value: activeWorkspaceIntelligence
        ? `Using ${activeWorkspaceIntelligence.source_count} authorized ${
            activeWorkspaceIntelligence.source_count === 1 ? "source" : "sources"
          }`
        : activeWorkspace?.current_user_role
        ? `Authorized as ${workspaceRoleLabel(activeWorkspace.current_user_role)}`
        : "Scoped authorization",
      color: "text-amber-200",
    },
    {
      icon: Users,
      label: "Presence",
      value: activeLiveStatus
        ? `${activeLiveStatus.active_count} active now`
        : presence
        ? `${presence.active_count} active now`
        : "Presence syncing",
      color: "text-emerald-200",
    },
  ];

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.85)] px-3 shadow-[0_12px_44px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:px-[18px]">
        <div className="flex min-w-0 items-center gap-2.5">
          {!historyOpen ? (
            <button
              type="button"
              onClick={onOpenHistory}
              className="omnix-ghost-action flex h-7 w-7 items-center justify-center rounded-[7px]"
              aria-label="Open history"
              title="Open history"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <div className="omnix-icon-tile h-7 w-7 bg-cyan-300/[0.08]">
            <Hash className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="omnix-display truncate text-sm font-semibold text-white">
              {currentConversation ? "Active intelligence session" : "New intelligence session"}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--omnix-text-3)]">
              <span className="h-[5px] w-[5px] rounded-full bg-[var(--omnix-green)] shadow-[0_0_5px_var(--omnix-green)]" />
              Active collaborative session
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {activeWorkspace ? (
            <WorkspaceMemberStack
              members={workspaceMembers}
              totalCount={activeWorkspace.member_count}
              size="sm"
              presenceMembers={presence?.recently_active_members ?? []}
              showPresence
            />
          ) : null}
          <div className="hidden items-center gap-1.5 rounded-[7px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2.5 py-1.5 text-[11px] text-[var(--omnix-text-2)] sm:flex">
            <BookOpen className="h-3 w-3" />
            Sources
            <span className="rounded-full border border-cyan-300/25 bg-cyan-300/15 px-1.5 py-px text-[9px] font-bold text-[var(--omnix-cyan)]">
              {activeWorkspaceIntelligence?.source_count ?? 0}
            </span>
          </div>
          <button
            type="button"
            className="flex items-center text-[var(--omnix-text-3)] transition hover:text-white"
            aria-label="Session actions"
            title="Session actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="hidden shrink-0 border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.48)] px-[18px] py-2 backdrop-blur-xl lg:block">
        <div className="grid grid-cols-5 gap-2">
          {statusItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-300/15 bg-cyan-300/10">
                  <Icon className={cn("h-3.5 w-3.5", item.color)} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
                    {item.label}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--omnix-text-2)]">
                    {item.value}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hidden shrink-0 border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.34)] px-[18px] py-2 backdrop-blur-xl xl:block">
        <WorkspacePresenceCluster
          presence={presence}
          workspaceName={activeWorkspace?.name}
          currentUserId={currentUserId}
          compact
        />
      </div>
    </>
  );
}
