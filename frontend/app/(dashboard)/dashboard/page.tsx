"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BrainCircuit,
  Cpu,
  Database,
  FileText,
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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";
import { initialsFromText, workspaceRoleLabel } from "@/lib/workspace-roles";
import { WorkspaceIntelligencePanel } from "@/components/workspace/WorkspaceIntelligencePanel";

type FileData = {
  id: string;
};

function roleColor(role?: string | null) {
  if (role === "owner" || role === "founder") return "var(--role-founder)";
  if (role === "co_owner") return "var(--role-coowner)";
  return "var(--role-member)";
}

function roleCssClass(role?: string | null) {
  if (role === "owner" || role === "founder") return "omnix-role-founder";
  if (role === "co_owner") return "omnix-role-coowner";
  return "omnix-role-member";
}

export default function DashboardPage() {
  const router = useRouter();
  const { conversations, loading: conversationsLoading } = useConversationHistory();
  const {
    activeWorkspace,
    activeMembers,
    activeInvites,
    pendingInvites,
    workspaces,
    activeWorkspaceIntelligence,
    intelligenceLoading,
  } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const memberCount = activeWorkspace?.member_count ?? activeMembers.length;
  const sharedState = activeWorkspace?.is_shared ? "Shared" : "Solo";

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const data = await apiClient.get<FileData[]>("/files");
      setFiles(data);
    } catch (err) {
      setFiles([]);
      setFilesError(err instanceof Error ? err.message : "Unable to load source count");
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, activeWorkspace?.id]);

  const metrics = [
    {
      label: "AI Conversations",
      value: conversationsLoading ? "..." : conversations.length,
      trend: conversations.length ? "Synced" : "Empty",
      icon: MessageSquare,
      color: "var(--omnix-cyan)",
      metricColor: "#00FFFF",
    },
    {
      label: "Team Members",
      value: memberCount,
      trend: activeWorkspace ? sharedState : "Loading",
      icon: Users,
      color: "var(--omnix-purple)",
      metricColor: "#9b5cff",
    },
    {
      label: "Knowledge Sources",
      value: filesLoading ? "..." : files.length,
      trend: filesError ? "Unavailable" : files.length ? "Indexed" : "Empty",
      icon: Database,
      color: "var(--omnix-pink)",
      metricColor: "#ff4df4",
    },
    {
      label: "Workspace Role",
      value: workspaceRoleLabel(activeWorkspace?.current_user_role),
      trend: pendingInvites.length ? `${pendingInvites.length} invite` : "Clear",
      icon: Cpu,
      color: "var(--omnix-green)",
      metricColor: "#00e87a",
    },
  ];

  const actions = [
    { label: "Analyze Document", desc: "Upload and query source material", icon: FileText, color: "#3366ff", href: "/sources" },
    { label: "Start AI Chat", desc: "Open a collaborative thread", icon: Sparkles, color: "#00FFFF", href: "/chat" },
    { label: "Deep Research", desc: "Use web and workspace context", icon: BrainCircuit, color: "#9b5cff", href: "/chat" },
    { label: "Workspace Map", desc: "Review hierarchy and subspaces", icon: Database, color: "#00e87a", href: "/workspace" },
    { label: "Team Management", desc: "Invite and manage roles", icon: Users, color: "#ffb800", href: "/team" },
  ];

  const recent = conversations.slice(0, 4);
  const workspaceMembers = activeMembers.length ? activeMembers : activeWorkspace?.members_preview ?? [];
  const recentWorkspaces = workspaces.slice(0, 4);
  const activityItems = [
    ...recent.slice(0, 2).map((conversation) => ({
      id: `conversation:${conversation.id}`,
      icon: MessageSquare,
      label: conversation.title || "Omnix conversation",
      detail: conversation.preview || "Conversation saved in history",
      color: "var(--omnix-cyan)",
    })),
    ...files.slice(0, 2).map((file) => ({
      id: `file:${file.id}`,
      icon: FileText,
      label: "Source uploaded",
      detail: "Workspace knowledge source available",
      color: "var(--omnix-green)",
    })),
    ...pendingInvites.slice(0, 1).map((invite) => ({
      id: `invite:${invite.id}`,
      icon: Users,
      label: "Workspace invite pending",
      detail: invite.workspace_name || invite.email,
      color: "var(--omnix-amber)",
    })),
  ];

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-6">

        <div className="relative overflow-hidden rounded-[28px] border border-[rgba(0,255,255,0.12)] bg-[radial-gradient(circle_at_12%_0%,rgba(0,255,255,0.16),transparent_32%),linear-gradient(145deg,rgba(8,20,36,0.94),rgba(6,9,18,0.86))] p-6 shadow-[0_30px_110px_rgba(0,0,0,0.38),var(--omnix-glow-xs)] sm:p-7">
          <div className="pointer-events-none absolute right-[-7rem] top-[-8rem] h-80 w-80 rounded-full bg-purple-400/10 blur-[95px]" />
          <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" />
                Omnix command center
              </p>
            <h1 className="omnix-page-title flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-sm)]">
                <Sparkles className="h-4 w-4 text-[var(--omnix-cyan)] drop-shadow-[0_0_10px_rgba(0,255,255,0.9)]" />
              </span>
              <span className="omnix-gradient-text">{activeWorkspace?.name ?? "Workspace Overview"}</span>
            </h1>
            <p className="omnix-page-subtitle">
              A real-time operating surface for workspace knowledge, AI sessions, hierarchy, and team access.
            </p>
            </div>
            <div className="grid min-w-[18rem] gap-2 sm:grid-cols-3 xl:min-w-[28rem]">
              {[
                { label: "Role", value: workspaceRoleLabel(activeWorkspace?.current_user_role), icon: ShieldCheck },
                { label: "Access", value: activeWorkspace?.is_shared ? "Shared" : "Private", icon: Users },
                { label: "Roots", value: workspaces.length, icon: Layers3 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
                    <Icon className="h-4 w-4 text-cyan-200" />
                    <div className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{item.label}</div>
                    <div className="mt-1 truncate text-sm font-semibold text-white">{item.value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            leftIcon={<Activity className="h-4 w-4 text-[var(--omnix-cyan)]" />}
            onClick={() => router.push("/analytics")}
            className="omnix-ghost-action shrink-0 border-[var(--omnix-border)] bg-[var(--omnix-surface)]"
          >
            View Full Report
          </Button>
        </div>

        {/* ── Metric Cards ── */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric, index) => {
            const Icon = metric.icon;
            return (
              <article
                key={metric.label}
                className="omnix-metric-card p-5"
                style={{
                  "--metric-color": metric.metricColor,
                  animation: `omnix-card-enter 0.45s ease-out ${index * 90}ms both`,
                } as CSSProperties}
              >
                <div className="relative z-10 flex items-start justify-between">
                  <div
                    className="rounded-xl p-2.5"
                    style={{
                      background: `${metric.metricColor}18`,
                      border: `1px solid ${metric.metricColor}28`,
                      boxShadow: `0 0 12px ${metric.metricColor}20`,
                    }}
                  >
                    <Icon className="h-5 w-5" style={{ color: metric.metricColor, filter: `drop-shadow(0 0 5px ${metric.metricColor}90)` }} />
                  </div>
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide"
                    style={{
                      background: `${metric.metricColor}12`,
                      border: `1px solid ${metric.metricColor}25`,
                      color: metric.metricColor,
                    }}
                  >
                    {metric.trend}
                  </span>
                </div>
                <div className="relative z-10 mt-5">
                  <div className="omnix-display text-3xl font-bold text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.08)]">
                    {metric.value}
                  </div>
                  <div className="mt-1.5 text-sm text-[var(--omnix-text-3)]">{metric.label}</div>
                </div>
              </article>
            );
          })}
        </div>

        <WorkspaceIntelligencePanel
          profile={activeWorkspaceIntelligence}
          loading={intelligenceLoading}
          compact
        />

        {/* ── Main grid ── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="space-y-6">

            <section className="omnix-section-card p-6" style={{ animation: "omnix-card-enter 0.45s ease-out 0.14s both" }}>
              <div className="omnix-top-line" />
              <div className="relative z-10 mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                  <Activity className="h-4 w-4 text-[var(--omnix-cyan)]" />
                  Recent activity
                </h2>
              </div>
              <div className="relative z-10 grid gap-2">
                {activityItems.length ? activityItems.map((activity) => {
                  const Icon = activity.icon;
                  return (
                    <div key={activity.id} className="flex items-center gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ background: `${activity.color}14`, borderColor: `${activity.color}33`, color: activity.color }}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">{activity.label}</span>
                        <span className="block truncate text-xs text-[var(--omnix-text-3)]">{activity.detail}</span>
                      </span>
                    </div>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-6 text-center">
                    <Activity className="mx-auto h-7 w-7 text-cyan-200/35" />
                    <p className="mt-3 text-sm font-semibold text-white">No activity yet</p>
                    <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Chats, source uploads, and invites will appear here as real events happen.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="omnix-section-card p-6" style={{ animation: "omnix-card-enter 0.45s ease-out 0.18s both" }}>
              {/* Top beam */}
              <div className="omnix-top-line" />
              <div className="relative z-10 mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/10">
                    <Zap className="h-3.5 w-3.5 text-amber-300 drop-shadow-[0_0_6px_rgba(255,184,0,0.8)]" />
                  </span>
                  Quick Actions
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
                      className="omnix-command-button group relative z-10 flex items-center gap-4 p-4 text-left"
                      style={{
                        "--command-color": action.color,
                        animation: `omnix-card-enter 0.4s ease-out ${0.22 + i * 0.06}s both`,
                      } as CSSProperties}
                    >
                      <span
                        className="rounded-xl p-2.5 transition-all duration-200 group-hover:scale-110"
                        style={{
                          background: `${action.color}18`,
                          border: `1px solid ${action.color}28`,
                          boxShadow: `0 0 10px ${action.color}18`,
                        }}
                      >
                        <Icon className="h-5 w-5" style={{ color: action.color, filter: `drop-shadow(0 0 4px ${action.color}80)` }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white transition-colors group-hover:text-[var(--omnix-cyan)]">
                          {action.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--omnix-text-3)]">{action.desc}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--omnix-text-3)] opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Recent AI Sessions */}
            <section className="omnix-section-card p-6" style={{ animation: "omnix-card-enter 0.45s ease-out 0.26s both" }}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
                    <History className="h-3.5 w-3.5 text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_rgba(0,255,255,0.8)]" />
                  </span>
                  Recent AI Sessions
                </h2>
                <button
                  type="button"
                  onClick={() => router.push("/history")}
                  className="flex items-center gap-1 text-xs font-semibold text-[var(--omnix-cyan)] transition hover:text-white"
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
                    className="group relative z-10 flex w-full items-center justify-between gap-3 rounded-[var(--omnix-radius-sm)] border border-transparent p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)]"
                    style={{ animation: `omnix-card-enter 0.38s ease-out ${0.3 + i * 0.07}s both` } as CSSProperties}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-100 shadow-[0_0_10px_rgba(0,255,255,0.1)]">
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
                  <div className="relative z-10 rounded-[var(--omnix-radius-sm)] border border-dashed border-[var(--omnix-border)] bg-[rgba(0,255,255,0.02)] p-6 text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-cyan-300/30" />
                    <p className="mt-3 text-sm font-medium text-[var(--omnix-text-2)]">No conversations yet</p>
                    <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Start a chat to populate the workspace timeline.</p>
                    <button
                      type="button"
                      onClick={() => router.push("/chat")}
                      className="omnix-primary-action mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold"
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
            <section className="omnix-section-card p-6" style={{ animation: "omnix-card-enter 0.45s ease-out 0.28s both" }}>
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
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-3 text-left transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)]"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-sm font-bold text-cyan-100">
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

            {/* Workspace State */}
            <section className="omnix-section-card p-6" style={{ animation: "omnix-card-enter 0.45s ease-out 0.32s both" }}>
              <div className="omnix-top-line" />
              <h2 className="relative z-10 mb-5 flex items-center gap-2 text-lg font-semibold text-white">
                <Activity className="h-4 w-4 text-[var(--omnix-green)] drop-shadow-[0_0_6px_rgba(0,232,122,0.8)]" />
                Workspace State
              </h2>
              <div className="relative z-10 space-y-3">
                {[
                  { label: "Workspace", value: activeWorkspace?.name ?? "No active workspace", color: "var(--omnix-green)" },
                  {
                    label: "Access",
                    value: activeWorkspace?.is_shared ? "Enabled" : "Private",
                    color: "var(--omnix-cyan)",
                  },
                  {
                    label: "Invite Queue",
                    value: activeInvites.length ? `${activeInvites.length} active` : "Clear",
                    color: "var(--omnix-amber)",
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-[var(--omnix-text-3)]">{item.label}</span>
                      <span className="truncate font-semibold" style={{ color: item.color }}>{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Workspace Members */}
            <section className="omnix-section-card flex flex-col p-6" style={{ animation: "omnix-card-enter 0.45s ease-out 0.4s both" }}>
              <div className="omnix-top-line" />
              <div className="relative z-10 mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-pink-300/25 bg-pink-300/10">
                    <Users className="h-3.5 w-3.5 text-pink-400" />
                  </span>
                  Workspace Members
                </h2>
              </div>

              <div className="relative z-10 flex-1 space-y-5">
                {workspaceMembers.length ? workspaceMembers.slice(0, 4).map((member, index, items) => {
                  const displayName = member.full_name || member.email || member.handle || "Workspace member";
                  const role = workspaceRoleLabel(member.role);
                  const color = roleColor(member.role);
                  const cssClass = roleCssClass(member.role);
                  return (
                  <div key={member.user_id || member.email || index} className="relative flex gap-4">
                    {index !== items.length - 1 ? (
                      <div className="absolute bottom-[-20px] left-4 top-11 w-px bg-[linear-gradient(180deg,var(--omnix-border),transparent)]" />
                    ) : null}
                    <div
                      className={`omnix-role-avatar ${cssClass} relative z-10 h-8 w-8 shrink-0 text-xs font-bold`}
                    >
                      {member.avatar_label || initialsFromText(displayName)}
                    </div>
                    <div className="pb-1 pt-0.5">
                      <div className="mb-1.5 text-sm leading-5">
                        <span className="font-semibold text-white">{displayName}</span>
                        {member.email ? <span className="text-[var(--omnix-text-3)]"> {member.email}</span> : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className="omnix-role-badge"
                          style={{ "--role-color": color } as CSSProperties}
                        >
                          {role}
                        </span>
                      </div>
                    </div>
                  </div>
                );
                }) : (
                  <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-5 text-center">
                    <Users className="mx-auto h-7 w-7 text-cyan-200/35" />
                    <p className="mt-3 text-sm font-semibold text-white">No members loaded yet</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">
                      Real workspace members will appear here after membership data is returned.
                    </p>
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
