"use client";

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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";
import { initialsFromText, workspaceRoleLabel } from "@/lib/workspace-roles";

function roleColor(role?: string | null) {
  if (role === "owner" || role === "founder") return "var(--omnix-red)";
  if (role === "co_owner") return "var(--omnix-amber)";
  return "var(--omnix-blue-bright)";
}

export default function DashboardPage() {
  const router = useRouter();
  const { conversations, loading: conversationsLoading } = useConversationHistory();
  const { activeWorkspace, activeMembers, activeInvites, pendingInvites } = useWorkspace();
  const memberCount = activeWorkspace?.member_count ?? activeMembers.length;
  const sharedState = activeWorkspace?.is_shared ? "Shared" : "Solo";

  const metrics = [
    {
      label: "AI Conversations",
      value: conversationsLoading ? "..." : conversations.length,
      trend: conversations.length ? "Synced" : "Ready",
      icon: MessageSquare,
      color: "var(--omnix-cyan)",
    },
    {
      label: "Team Members",
      value: memberCount || 1,
      trend: activeWorkspace ? sharedState : "Loading",
      icon: Users,
      color: "var(--omnix-cyan)",
    },
    {
      label: "Knowledge Sources",
      value: "Live",
      trend: "Upload ready",
      icon: Database,
      color: "var(--omnix-pink)",
    },
    {
      label: "Workspace Role",
      value: workspaceRoleLabel(activeWorkspace?.current_user_role),
      trend: pendingInvites.length ? `${pendingInvites.length} invite` : "Clear",
      icon: Cpu,
      color: "var(--omnix-green)",
    },
  ];

  const actions = [
    { label: "Analyze Document", desc: "Upload and query source material", icon: FileText, color: "var(--omnix-blue)", href: "/files" },
    { label: "Start AI Chat", desc: "Open a collaborative thread", icon: Sparkles, color: "var(--omnix-cyan)", href: "/chat" },
    { label: "Deep Research", desc: "Use web and workspace context", icon: BrainCircuit, color: "var(--omnix-purple)", href: "/chat" },
    { label: "Team Management", desc: "Invite and manage roles", icon: Users, color: "var(--omnix-amber)", href: "/settings/team" },
  ];

  const recent = conversations.slice(0, 4);
  const teamActivity = activeMembers.slice(0, 4).map((member, index) => ({
    id: member.user_id || `${member.email}-${index}`,
    user: member.full_name || member.email || "Workspace member",
    role: workspaceRoleLabel(member.role),
    roleColor: roleColor(member.role),
    action: index === 0 ? "is active in" : index === 1 ? "joined" : "contributed to",
    target: activeWorkspace?.name ?? "Omnix workspace",
    time: member.updated_at || member.created_at ? "Recently" : index === 0 ? "Now" : `${index + 1}h ago`,
    avatar: member.avatar_label || initialsFromText(member.full_name || member.email),
  }));

  return (
    <section className="omnix-scrollbar h-full w-full overflow-y-auto overflow-x-hidden px-5 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 pb-12">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="omnix-display flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
            <Sparkles className="h-5 w-5 text-[var(--omnix-cyan)] drop-shadow-[0_0_10px_rgba(0,255,255,0.7)]" />
            Workspace Overview
          </h1>
          <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
            Real-time insights across {activeWorkspace?.name ?? "your team"} AI interactions and data sources.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          leftIcon={<Activity className="h-4 w-4 text-[var(--omnix-cyan)]" />}
          onClick={() => router.push("/history")}
          className="omnix-ghost-action border-[var(--omnix-border)] bg-[var(--omnix-surface)]"
        >
          View Full Report
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <article
              key={metric.label}
              className="omnix-replit-panel p-5"
              style={{ animation: `omnix-slide-in 0.4s ease-out ${index * 100}ms both` }}
            >
              <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40" style={{ background: metric.color }} />
              <div className="relative z-10 flex items-start justify-between">
                <div className="rounded-lg p-2" style={{ background: `${metric.color}22` }}>
                  <Icon className="h-5 w-5" style={{ color: metric.color }} />
                </div>
                <span className="rounded-full bg-white/[0.05] px-2 py-1 text-xs font-medium text-[var(--omnix-text-2)]">
                  {metric.trend}
                </span>
              </div>
              <div className="relative z-10 mt-5">
                <div className="omnix-display text-3xl font-bold text-white">{metric.value}</div>
                <div className="mt-1 text-sm text-[var(--omnix-text-3)]">{metric.label}</div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="space-y-6">
          <section className="omnix-section-card p-6" style={{ animationDelay: "0.2s" }}>
            <div className="relative z-10 mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Zap className="h-4 w-4 text-amber-300" />
              Quick Actions
            </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => router.push(action.href)}
                    className="group relative z-10 flex items-center gap-4 rounded-lg border border-transparent bg-white/[0.02] p-4 text-left transition-all duration-150 hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface-hover)]"
                  >
                    <span className="rounded-md p-2" style={{ background: `${action.color}22` }}>
                      <Icon className="h-5 w-5" style={{ color: action.color }} />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-white transition-colors group-hover:text-[#00e8e8]">{action.label}</span>
                      <span className="mt-1 block text-xs text-[var(--omnix-text-3)]">{action.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="omnix-section-card p-6" style={{ animationDelay: "0.3s" }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <History className="h-4 w-4 text-[var(--omnix-cyan)]" />
                Recent AI Sessions
              </h2>
              <button type="button" onClick={() => router.push("/history")} className="text-xs font-semibold text-[var(--omnix-cyan)] transition hover:text-white">
                View all
              </button>
            </div>
            <div className="space-y-2">
              {recent.length ? recent.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => router.push(`/chat?conversation=${chat.id}`)}
                  className="group relative z-10 flex w-full items-center justify-between gap-3 rounded-lg border border-transparent p-3 text-left transition-colors hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface-hover)]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-300/[0.08] text-cyan-100">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white">{chat.title || "Omnix conversation"}</span>
                      <span className="mt-1 block truncate text-xs text-[var(--omnix-text-3)]">{chat.preview || "No preview yet"}</span>
                    </span>
                  </span>
                </button>
              )) : (
                <div className="rounded-lg border border-dashed border-[var(--omnix-border)] p-5 text-sm text-[var(--omnix-text-2)]">
                  No conversations yet. Start a chat to populate the workspace timeline.
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="omnix-section-card p-6" style={{ animationDelay: "0.4s" }}>
            <h2 className="relative z-10 mb-6 text-lg font-semibold text-white">Workspace Health</h2>
            <div className="relative z-10 space-y-5">
              {[
                ["Session security", "Protected", 92, "var(--omnix-green)"],
                ["Shared context", activeWorkspace?.is_shared ? "Enabled" : "Private", activeWorkspace?.is_shared ? 78 : 42, "var(--omnix-cyan)"],
                ["Invite queue", activeInvites.length ? `${activeInvites.length} active` : "Clear", activeInvites.length ? 64 : 18, "var(--omnix-amber)"],
              ].map(([label, value, width, color]) => (
                <div key={label as string}>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-[var(--omnix-text-2)]">{label}</span>
                    <span className="font-medium" style={{ color: color as string }}>{value}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${width}%`, background: color as string, boxShadow: `0 0 10px ${color}` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="omnix-section-card flex flex-col p-6" style={{ animationDelay: "0.5s" }}>
            <div className="relative z-10 mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <Users className="h-4 w-4 text-pink-400" />
                Team Activity
              </h2>
            </div>

            <div className="relative z-10 flex-1 space-y-4">
              {(teamActivity.length ? teamActivity : [{
                id: "empty",
                user: activeWorkspace?.name ?? "Omnix workspace",
                role: workspaceRoleLabel(activeWorkspace?.current_user_role),
                roleColor: roleColor(activeWorkspace?.current_user_role),
                action: "is ready for",
                target: "collaboration",
                time: "Now",
                avatar: (activeWorkspace?.name ?? "O").charAt(0).toUpperCase(),
              }]).map((activity, index, items) => (
                <div key={activity.id} className="relative flex gap-4">
                  {index !== items.length - 1 ? (
                    <div className="absolute bottom-[-16px] left-4 top-10 w-px bg-[var(--omnix-border)]" />
                  ) : null}
                  <div
                    className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-xs font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${activity.roleColor}, rgba(0,0,0,0.8))` }}
                  >
                    {activity.avatar}
                  </div>
                  <div className="pb-1">
                    <div className="mb-1 text-sm leading-5">
                      <span className="font-medium text-white">{activity.user}</span>
                      <span className="text-[var(--omnix-text-3)]"> {activity.action} </span>
                      <span className="font-medium text-[var(--omnix-cyan-dim)]">{activity.target}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                        style={{ color: activity.roleColor, background: `${activity.roleColor}15` }}
                      >
                        {activity.role}
                      </span>
                      <span className="text-[var(--omnix-text-3)]">· {activity.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
      </div>
    </section>
  );
}
