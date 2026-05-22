"use client";

import {
  Activity,
  BrainCircuit,
  Database,
  FileText,
  Layers3,
  MessageSquare,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { cn } from "@/lib/utils";
import type { WorkspaceActivityEvent } from "@/lib/workspace-types";

type WorkspaceActivityFeedProps = {
  activity: WorkspaceActivityEvent[];
  loading?: boolean;
  compact?: boolean;
  className?: string;
};

const eventIcon = {
  "workspace.created": Layers3,
  "workspace.subspace_created": Layers3,
  "workspace.invite_created": UserPlus,
  "workspace.invite_revoked": UserPlus,
  "workspace.member_joined": Users,
  "workspace.member_removed": Users,
  "workspace.member_role_updated": ShieldCheck,
  "workspace.source_uploaded": FileText,
  "workspace.source_connected": Database,
  "workspace.source_removed": Database,
  "workspace.intelligence_updated": BrainCircuit,
  "workspace.ai_response_generated": MessageSquare,
} satisfies Record<string, typeof Activity>;

function actorName(item: WorkspaceActivityEvent) {
  return item.actor_name || item.actor_email || "Omnix";
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(deltaMs / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function WorkspaceActivityFeed({
  activity,
  loading,
  compact = false,
  className,
}: WorkspaceActivityFeedProps) {
  const visibleActivity = compact ? activity.slice(0, 5) : activity;

  return (
    <section className={cn("relative overflow-hidden rounded-[14px] border border-[var(--omnix-border)] bg-black/15", compact ? "p-4" : "p-5", className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(155,92,255,0.62),rgba(0,255,255,0.56),transparent)]" />
      <div className="relative z-10 mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">
            <Activity className="h-3.5 w-3.5 text-[var(--omnix-cyan)]" />
            Live activity
          </div>
          <h3 className="mt-1 text-base font-semibold text-white">Workspace pulse</h3>
        </div>
        {loading ? (
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-100">
            Syncing
          </span>
        ) : (
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-100">
            Real events
          </span>
        )}
      </div>

      <div className="relative z-10 space-y-2">
        {visibleActivity.length ? visibleActivity.map((item) => {
          const Icon = eventIcon[item.event_type as keyof typeof eventIcon] ?? Activity;
          return (
            <div
              key={item.id}
              className="group flex items-center gap-3 rounded-[10px] border border-white/[0.06] bg-[rgba(255,255,255,0.025)] px-3 py-3 transition hover:border-cyan-300/18 hover:bg-cyan-300/[0.045]"
            >
              <ProfileAvatar
                name={actorName(item)}
                email={item.actor_email}
                avatarUrl={item.actor_avatar_url}
                className="h-8 w-8 rounded-lg border border-cyan-200/18 bg-cyan-300/10 text-xs font-bold"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                  <p className="truncate text-sm font-semibold text-white">{item.summary}</p>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--omnix-text-3)]">
                  {actorName(item)} - {formatRelativeTime(item.created_at)}
                </p>
              </div>
            </div>
          );
        }) : (
          <div className="rounded-[12px] border border-dashed border-[var(--omnix-border)] bg-black/15 p-5 text-center">
            <Activity className="mx-auto h-7 w-7 text-cyan-200/35" />
            <p className="mt-3 text-sm font-semibold text-white">No activity yet</p>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">
              Real workspace events will appear here after teammates, sources, and AI runs change this space.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
