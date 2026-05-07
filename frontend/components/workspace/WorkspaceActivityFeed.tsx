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
  const name = item.actor_name || item.actor_email || "Omnix";
  if (name === "Omnix AI") return "Omnix";
  return name;
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
    <section className={cn(
      "relative overflow-hidden rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.4))] shadow-2xl backdrop-blur-xl", 
      compact ? "p-4" : "p-5", 
      className
    )}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(155,92,255,0.4),rgba(0,255,255,0.3),transparent)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-white/5 to-transparent" />

      <div className="relative z-10 mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200/50">
            <Activity className={cn("h-3.5 w-3.5", !loading && "text-cyan-400/80")} />
            Recent Updates
          </div>
          <h3 className="mt-1.5 text-lg font-medium tracking-tight text-white/90">Workspace Activity</h3>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400/50" />
          )}
          <span className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
            loading 
              ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300/70" 
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/70"
          )}>
            {loading ? "Syncing" : "Live"}
          </span>
        </div>
      </div>

      <div className="relative z-10 space-y-4">
        {visibleActivity.length ? (
          <div className="relative space-y-3 before:absolute before:left-[1.35rem] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-gradient-to-b before:from-white/10 before:via-white/5 before:to-transparent">
            {visibleActivity.map((item) => {
              const Icon = eventIcon[item.event_type as keyof typeof eventIcon] ?? Activity;
              const isAI = item.event_type.includes("ai_") || item.actor_user_id === "system";
              
              return (
                <div
                  key={item.id}
                  className="group relative flex gap-4 pl-0 transition-all duration-300"
                >
                  <div className="relative z-10 shrink-0">
                    <ProfileAvatar
                      name={actorName(item)}
                      email={item.actor_email}
                      avatarUrl={item.actor_avatar_url}
                      className={cn(
                        "h-11 w-11 rounded-xl border bg-black/40 text-sm font-medium transition-all duration-500 group-hover:scale-[1.02]",
                        isAI 
                          ? "border-purple-500/20" 
                          : "border-cyan-500/10"
                      )}
                    />
                    <div className={cn(
                      "absolute -right-1 -top-1 rounded-full border border-white/10 p-1 shadow-sm backdrop-blur-md",
                      isAI ? "bg-purple-600/80" : "bg-cyan-600/80"
                    )}>
                      <Icon className="h-2.5 w-2.5 text-white/90" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-medium text-white/90 group-hover:text-cyan-100 transition-colors">
                        {item.summary}
                      </p>
                      <span className="shrink-0 text-[10px] font-medium text-white/30">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cn(
                        "text-[10px] font-bold tracking-wide",
                        isAI ? "text-purple-400/80" : "text-cyan-400/80"
                      )}>
                        {actorName(item)}
                      </span>
                      <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
                      <span className="text-[10px] font-medium text-white/20 uppercase tracking-tight">
                        {item.event_type.split('.').pop()?.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/5 bg-white/[0.01] p-10 text-center">
            <div className="relative">
              <Activity className="h-10 w-10 text-white/10" />
            </div>
            <p className="mt-4 text-sm font-medium text-white/60">Quiet right now</p>
            <p className="mt-2 max-w-[200px] text-[11px] leading-relaxed text-white/30">
              Waiting for activity. Teammate updates and AI insights will appear here.
            </p>
          </div>
        )}
      </div>
      
      {!compact && visibleActivity.length > 0 && (
        <div className="mt-6 flex justify-center">
          <button className="text-[10px] font-medium uppercase tracking-widest text-white/30 hover:text-cyan-300 transition-colors">
            View all activity
          </button>
        </div>
      )}
    </section>
  );
}
