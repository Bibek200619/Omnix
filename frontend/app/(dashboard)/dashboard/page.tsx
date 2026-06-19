"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Database,
  History,
  MessageSquare,
  Sparkles,
  Users,
  Zap,
  ArrowUpRight,
  Clock,
  ChevronRight,
  Layers3,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { PageTitle } from "@/components/ui/Typography";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { workspaceRoleLabel } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";
import { WorkspaceIntelligencePanel } from "@/components/workspace/WorkspaceIntelligencePanel";
import { WorkspaceActivityFeed } from "@/components/workspace/WorkspaceActivityFeed";
import { WorkspacePresenceCluster } from "@/components/workspace/WorkspacePresenceCluster";

type FileData = {
  id: string;
};

const pageEnterDelayClasses = [
  "omnix-page-enter-delay-1",
  "omnix-page-enter-delay-2",
  "omnix-page-enter-delay-3",
  "omnix-page-enter-delay-4",
  "omnix-page-enter-delay-5",
  "omnix-page-enter-delay-6",
];

function pageEnterDelay(index: number) {
  return pageEnterDelayClasses[Math.min(index, pageEnterDelayClasses.length - 1)];
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardPageContent />
    </Suspense>
  );
}

function DashboardPageContent() {
  const router = useRouter();
  const { conversations } = useConversationHistory();
  const {
    activeWorkspace,
    workspaces,
    activeWorkspaceIntelligence,
    intelligenceError,
    intelligenceLoading,
  } = useWorkspace();
  const { activity, loadingActivity, presence } = useWorkspaceCollaboration();
  const [, setFiles] = useState<FileData[]>([]);
  const [, setFilesLoading] = useState(false);
  const [, setFilesError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const data = await apiClient.get<FileData[]>("/files");
      setFiles(data);
    } catch (err) {
      setFiles([]);
      logClientError("Failed to load source count", err, { endpoint: "/files" });
      setFilesError("Unable to load source count. Check your connection and try again.");
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, activeWorkspace?.id]);

  const actions = [
    {
      label: "Workspace Map",
      desc: "Review hierarchy and subspaces",
      icon: Database,
      color: "var(--omnix-green)",
      surface: "var(--omnix-rgba-0-232-122-0-18)",
      border: "var(--omnix-rgba-0-232-122-0-28)",
      glow: "var(--omnix-rgba-0-232-122-0-18)",
      iconGlow: "var(--omnix-rgba-0-232-122-0-8)",
      href: "/workspace",
    },
    {
      label: "Team Management",
      desc: "Invite and manage roles",
      icon: Users,
      color: "var(--omnix-amber)",
      surface: "var(--omnix-rgba-255-184-0-18)",
      border: "var(--omnix-rgba-255-184-0-28)",
      glow: "var(--omnix-rgba-255-184-0-18)",
      iconGlow: "var(--omnix-rgba-255-184-0-8)",
      href: "/team",
    },
  ];

  const recent = conversations.slice(0, 4);
  const recentWorkspaces = workspaces.slice(0, 4);
  const workspacePulse = [
    {
      label: "Live Members",
      value: presence?.active_count ?? presence?.online_count ?? 0,
      detail: "connected now",
      icon: Activity,
      accent: "var(--omnix-green)",
      fill: Math.min(((presence?.active_count ?? presence?.online_count ?? 0) / 8) * 100, 100),
    },
    {
      label: "AI Sessions",
      value: conversations.length,
      detail: recent.length ? "recent threads" : "ready to start",
      icon: MessageSquare,
      accent: "var(--omnix-cyan)",
      fill: Math.min((conversations.length / 12) * 100, 100),
    },
    {
      label: "Activity",
      value: activity.length,
      detail: loadingActivity ? "syncing updates" : "latest events",
      icon: Zap,
      accent: "var(--omnix-amber)",
      fill: loadingActivity ? 62 : Math.min((activity.length / 12) * 100, 100),
    },
    {
      label: "Workspace Roots",
      value: workspaces.length,
      detail: "available spaces",
      icon: Layers3,
      accent: "var(--omnix-purple)",
      fill: Math.min((workspaces.length / 8) * 100, 100),
    },
  ];

  const heroActions = [
    { label: "Start Chat", href: "/chat", icon: Sparkles, variant: "primary" },
    { label: "Upload Sources", href: "/sources", icon: UploadCloud, variant: "secondary" },
    { label: "View Report", href: "/analytics", icon: BarChart3, variant: "ghost" },
  ];

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-4 sm:gap-6">

        <div className="omnix-dashboard-hero omnix-page-enter">
          <div className="omnix-dashboard-grid" />
          <div className="omnix-dashboard-sheen" />
          <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" />
                Omnix command center
              </p>
              <PageTitle className="flex items-center gap-3 text-balance">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-sm)]">
                  <Sparkles className="h-4 w-4 text-[var(--omnix-cyan)] drop-shadow-[0_0_10px_var(--omnix-rgba-0-255-255-0-9)]" />
                </span>
                <span className="omnix-gradient-text break-words">{activeWorkspace?.name ?? "Workspace Overview"}</span>
              </PageTitle>
              <p className="omnix-page-subtitle hidden max-w-3xl text-pretty sm:block">
                A real-time operating surface for workspace knowledge, AI sessions, hierarchy, and team access.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 sm:mt-5">
                {heroActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => router.push(action.href)}
                      className={cn(
                        "omnix-dashboard-hero-action group",
                        action.variant === "primary" && "omnix-dashboard-hero-action-primary",
                        action.variant === "secondary" && "omnix-dashboard-hero-action-secondary",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{action.label}</span>
                      <ChevronRight className="h-3.5 w-3.5 opacity-60 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 xl:min-w-[28rem]">
              {[
                { label: "Role", value: workspaceRoleLabel(activeWorkspace?.current_user_role), icon: ShieldCheck },
                { label: "Access", value: activeWorkspace?.is_shared ? "Shared" : "Private", icon: Users },
                { label: "Roots", value: workspaces.length, icon: Layers3 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={cn(
                    "min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.035] p-2.5 transition-colors duration-150 ease-out hover:bg-white/[0.05] sm:p-3"
                  )}>
                    <Icon className="h-3.5 w-3.5 text-cyan-200 sm:h-4 sm:w-4" />
                    <div className="mt-2 truncate text-[9px] uppercase tracking-[0.12em] text-[var(--omnix-text-3)] sm:mt-3 sm:text-[10px]">{item.label}</div>
                    <div className="mt-1 truncate text-sm font-semibold text-white">{item.value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workspacePulse.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => router.push(i === 1 ? "/history" : i === 2 ? "/workspace" : "/analytics")}
                className={cn("omnix-dashboard-metric group/dashboard-metric omnix-page-enter text-left", pageEnterDelay(i + 1))}
                style={{ "--metric-accent": item.accent, "--metric-fill": `${item.fill}%` } as CSSProperties}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="omnix-dashboard-metric-icon">
                    <Icon className="h-4 w-4" />
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--omnix-text-3)] transition-transform duration-150 ease-out group-hover/dashboard-metric:-translate-y-0.5 group-hover/dashboard-metric:translate-x-0.5" />
                </span>
                <span className="mt-4 block text-2xl font-semibold tabular-nums text-white">{item.value}</span>
                <span className="mt-1 flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{item.label}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--omnix-text-2)]">{item.detail}</span>
                  </span>
                </span>
                <span className="omnix-dashboard-meter" />
              </button>
            );
          })}
        </div>

        <WorkspaceIntelligencePanel
          profile={activeWorkspaceIntelligence}
          loading={intelligenceLoading}
          error={intelligenceError}
          compact
        />

        {/* ── Main grid ── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="space-y-6">

            <WorkspaceActivityFeed
              activity={activity}
              loading={loadingActivity}
              compact
              className="omnix-section-card"
            />

            <WorkspacePresenceCluster
              presence={presence}
              workspaceName={activeWorkspace?.name}
            />

            <section className="omnix-section-card omnix-page-enter omnix-page-enter-delay-3 p-4 sm:p-6">
              {/* Top beam */}
              <div className="omnix-top-line" />
              <div className="relative z-10 mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10">
                    <Zap className="h-3.5 w-3.5 text-amber-300 drop-shadow-[0_0_6px_var(--omnix-rgba-255-184-0-8)]" />
                  </span>
                  Workspace Shortcuts
                </h2>
                <span className="omnix-dot-badge" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {actions.map((action, i) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => router.push(action.href)}
                      className={cn("omnix-command-button omnix-page-enter group relative z-10 flex items-center gap-4 p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas", pageEnterDelay(i + 3))}
                      style={{
                        "--command-color": action.color,
                      } as CSSProperties}
                    >
                      <div
                        className="pointer-events-none absolute inset-0 w-2/5 bg-[linear-gradient(90deg,transparent,var(--omnix-rgba-0-255-255-0-08),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                        style={{ animation: "omnix-sheen-sweep 4s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
                      />
                      <span
                        className="rounded-xl p-2.5 transition-transform duration-150 ease-out group-hover:scale-105"
                        style={{
                          background: action.surface,
                          border: `1px solid ${action.border}`,
                          boxShadow: `0 0 10px ${action.glow}`,
                        }}
                      >
                        <Icon className="h-5 w-5" style={{ color: action.color, filter: `drop-shadow(0 0 4px ${action.iconGlow})` }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white transition-colors group-hover:text-[var(--omnix-cyan)]">
                          {action.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--omnix-text-3)]">{action.desc}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--omnix-text-3)] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Recent AI Sessions */}
            <section className="omnix-section-card omnix-page-enter omnix-page-enter-delay-4 p-4 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
                    <History className="h-3.5 w-3.5 text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_var(--omnix-rgba-0-255-255-0-8)]" />
                  </span>
                  Recent AI Sessions
                </h2>
                <button
                  type="button"
                  onClick={() => router.push("/history")}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-[var(--omnix-cyan)] transition-colors duration-150 ease-out hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  View all <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="space-y-2">
                {recent.length ? recent.map((chat, i) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => router.push(`/chat?conversation=${chat.id}`)}
                    className={cn(
                      "group relative z-10 flex w-full items-center justify-between gap-3 rounded-[var(--omnix-radius-sm)] border border-transparent p-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                      "omnix-page-enter",
                      pageEnterDelay(i + 4),
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-100 shadow-[0_0_10px_var(--omnix-rgba-0-255-255-0-1)]">
                        <MessageSquare className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">{chat.title || "Omnix conversation"}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--omnix-text-3)]">
                          <Clock className="h-3 w-3" />
                          {chat.preview || "No preview yet"}
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--omnix-text-3)] opacity-0 transition group-hover:opacity-100" />
                  </button>
                )) : (
                  <div className="relative z-10 rounded-[var(--omnix-radius-sm)] border border-dashed border-[var(--omnix-border)] bg-[var(--omnix-rgba-0-255-255-0-02)] p-6 text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-cyan-300/30" />
                    <p className="mt-3 text-sm font-medium text-[var(--omnix-text-2)]">No conversations yet</p>
                    <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Start a chat to populate the workspace timeline.</p>
                    <button
                      type="button"
                      onClick={() => router.push("/chat")}
                      className="omnix-primary-action mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Start Chat
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* ── Sidebar panels ── */}
          <aside className="space-y-6">
            <section className="omnix-section-card omnix-page-enter omnix-page-enter-delay-5 p-4 sm:p-6">
              <div className="omnix-top-line" />
              <h2 className="relative z-10 mb-5 flex items-center gap-2 text-lg font-semibold text-white">
                <Layers3 className="h-4 w-4 text-[var(--omnix-purple)]" />
                Recent Workspaces
              </h2>
              <div className="relative z-10 space-y-2">
                {recentWorkspaces.length ? recentWorkspaces.map((workspace, index) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => router.push("/workspace")}
                    className="group flex w-full items-center gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-sm font-bold text-cyan-100 transition-transform duration-150 ease-out group-hover:scale-105">
                      {workspace.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{workspace.name}</span>
                      <span className="block truncate text-xs text-[var(--omnix-text-3)]">{workspace.subspaces?.length ?? 0} subspaces</span>
                    </span>
                    <span className="text-[10px] text-[var(--omnix-text-3)]">#{index + 1}</span>
                  </button>
                )) : (
                  <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-5 text-center text-sm text-[var(--omnix-text-2)]">
                    No workspaces yet
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
