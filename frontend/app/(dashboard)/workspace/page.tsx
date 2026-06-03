"use client";

import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Crown,
  Database,
  History,
  Layers3,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Portal } from "@/components/ui/Portal";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { WorkspaceIntelligencePanel } from "@/components/workspace/WorkspaceIntelligencePanel";
import { WorkspacePresenceCluster } from "@/components/workspace/WorkspacePresenceCluster";
import { WorkspaceActivityFeed } from "@/components/workspace/WorkspaceActivityFeed";
import { WorkspaceOperationalTimeline } from "@/components/workspace/WorkspaceOperationalTimeline";
import { logClientError } from "@/lib/errors";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceContinuity } from "@/lib/workspace-continuity-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import {
  isWorkspaceFounderRole,
  workspaceRoleBadgeClass,
  workspaceRoleLabel,
} from "@/lib/workspace-roles";
import type { Workspace } from "@/lib/workspace-types";

function workspaceColor(index: number) {
  return ["var(--omnix-cyan)", "var(--omnix-purple)", "var(--omnix-green)", "var(--omnix-amber)", "var(--omnix-pink)"][index % 5];
}

function selectionId(workspaceId: string) {
  return workspaceId;
}

function selectedWorkspace(workspaces: Workspace[], selectedId: string | null, fallback: Workspace | null) {
  if (!selectedId) return fallback;
  const stack = [...workspaces];
  while (stack.length) {
    const workspace = stack.shift();
    if (!workspace) continue;
    if (workspace.id === selectedId) return workspace;
    stack.push(...(workspace.subspaces ?? []));
  }
  return fallback;
}

export default function WorkspacePage() {
  const router = useRouter();
  const {
    activeWorkspace,
    activeWorkspaceId,
    activeMembers,
    activeInvites,
    activeWorkspaceIntelligence,
    intelligenceError,
    createWorkspace,
    createSubspace,
    loading,
    setActiveWorkspace,
    workspaces,
  } = useWorkspace();
  const { initiatives, timeline, loading: loadingContinuity } = useWorkspaceContinuity();
  const { activity, loadingActivity, presence, statusForWorkspace } = useWorkspaceCollaboration();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    // Only expand the active root workspace by default
    const initial: Record<string, boolean> = {};
    const rootId = activeWorkspace?.parent_workspace_id || activeWorkspace?.id;
    if (rootId) {
      initial[rootId] = true;
    }
    return initial;
  });
  const [selectedId, setSelectedId] = useState<string | null>(
    activeWorkspaceId ? selectionId(activeWorkspaceId) : null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [subspaceOpen, setSubspaceOpen] = useState(false);
  const [subspaceParentId, setSubspaceParentId] = useState(activeWorkspaceId ?? "");
  const [subspaceName, setSubspaceName] = useState("");
  const [subspaceDescription, setSubspaceDescription] = useState("");
  const [creatingSubspace, setCreatingSubspace] = useState(false);
  const [subspaceError, setSubspaceError] = useState<string | null>(null);

  const selected = selectedWorkspace(workspaces, selectedId, activeWorkspace);
  const DetailIcon = Layers3;
  const selectedIndex = selected ? Math.max(0, workspaces.findIndex((workspace) => workspace.id === selected.id)) : 0;
  const selectedColor = workspaceColor(selectedIndex);
  const members = activeMembers.length > 0 ? activeMembers : selected?.members_preview ?? [];
  const selectedLiveStatus = statusForWorkspace(selected?.id);

  const workspaceMetrics = useMemo(
    () => [
      { label: "Active now", value: selectedLiveStatus?.active_count ?? presence?.active_count ?? 0, icon: Users, color: selectedColor },
      { label: "Subspaces", value: selected?.subspaces?.length ?? 0, icon: Layers3, color: "var(--omnix-purple)" },
      { label: "Sources", value: selectedLiveStatus?.source_count ?? 0, icon: Database, color: "var(--omnix-green)" },
      { label: "Invites", value: activeInvites.length || "Clear", icon: UserPlus, color: "var(--omnix-amber)" },
    ],
    [activeInvites.length, presence?.active_count, selected, selectedColor, selectedLiveStatus?.active_count, selectedLiveStatus?.source_count],
  );

  function toggle(workspaceId: string) {
    setExpanded((current) => ({ ...current, [workspaceId]: !(current[workspaceId] ?? true) }));
  }

  function choose(workspace: Workspace) {
    setSelectedId(selectionId(workspace.id));
    setActiveWorkspace(workspace.id);
  }

  function openSubspaceCreator(parentId?: string | null) {
    const fallbackParent = selected?.parent_workspace_id || selected?.id || activeWorkspaceId || workspaces[0]?.id || "";
    setSubspaceParentId(parentId || fallbackParent);
    setSubspaceName("");
    setSubspaceDescription("");
    setSubspaceError(null);
    setSubspaceOpen(true);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setCreateError("Workspace name is required.");
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);
      const created = await createWorkspace({
        name,
        description: newDescription.trim() || undefined,
      });
      setActiveWorkspace(created.id);
      setSelectedId(selectionId(created.id));
      setExpanded((current) => ({ ...current, [created.id]: true }));
      setNewName("");
      setNewDescription("");
      setCreateOpen(false);
    } catch (err) {
      logClientError("Failed to create workspace", err, { endpoint: "/workspaces" });
      setCreateError("Unable to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateSubspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = subspaceName.trim();
    const parentId = subspaceParentId.trim();
    if (!parentId) {
      setSubspaceError("Choose a parent workspace.");
      return;
    }
    if (!name) {
      setSubspaceError("Subworkspace name is required.");
      return;
    }

    try {
      setCreatingSubspace(true);
      setSubspaceError(null);
      const created = await createSubspace(parentId, {
        name,
        description: subspaceDescription.trim() || undefined,
      });
      setExpanded((current) => ({ ...current, [parentId]: true }));
      setActiveWorkspace(created.id);
      setSelectedId(selectionId(created.id));
      setSubspaceOpen(false);
    } catch (err) {
      logClientError("Failed to create subworkspace", err);
      setSubspaceError("Unable to create subworkspace.");
    } finally {
      setCreatingSubspace(false);
    }
  }

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max max-w-[92rem] space-y-5">
        <div className="omnix-page-hero">
          <div>
            <div className="flex items-center gap-3">
              <Network className="h-6 w-6 text-[var(--omnix-cyan)] drop-shadow-[0_0_16px_rgba(0,255,255,0.75)]" />
              <h1 className="omnix-page-title omnix-gradient-text">Workspace Hierarchy</h1>
            </div>
            <p className="omnix-page-subtitle">
              Manage super workspaces, collaborative spaces, team access, and knowledge context without leaving the Omnix operating surface.
            </p>
          </div>
          <Button
            type="button"
            className="omnix-primary-action h-11 w-full rounded-[9px] px-4 sm:w-auto"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            New workspace
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full rounded-[9px] border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-4 sm:w-auto"
            leftIcon={<Layers3 className="h-4 w-4" />}
            disabled={workspaces.length === 0}
            onClick={() => openSubspaceCreator()}
          >
            New subworkspace
          </Button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside className="omnix-glass-band p-4">
            <div className="relative z-10 mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Organization Tree</p>
                <p className="mt-1 text-xs text-[var(--omnix-text-2)]">Root workspace with inherited collaboration layers.</p>
              </div>
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--omnix-text-3)]" /> : null}
            </div>

            <div className="relative z-10 space-y-3">
              {workspaces.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--omnix-border)] bg-black/15 p-4 text-sm text-[var(--omnix-text-2)]">
                  No workspaces yet. Create the first root workspace to start the hierarchy.
                </div>
              ) : (
                workspaces.map((workspace, index) => {
                  const color = workspaceColor(index);
                  const open = expanded[workspace.id] ?? true;
                  const rootActive = selected?.id === workspace.id;
                  const liveStatus = statusForWorkspace(workspace.id);

                  return (
                    <div key={workspace.id}>
                      <div
                        className={cn(
                          "group flex items-center gap-2 rounded-[var(--omnix-radius-sm)] border px-2.5 py-2.5 transition",
                          rootActive
                            ? "border-cyan-300/25 bg-[radial-gradient(ellipse_at_0%_50%,rgba(0,255,255,0.1),transparent_70%),rgba(0,255,255,0.06)] shadow-[var(--omnix-glow-xs)]"
                            : "border-[var(--omnix-border)] bg-[var(--omnix-surface)] hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface-hover)]",
                        )}
                      >
                        <button
                          type="button"
                          className="text-[var(--omnix-text-3)] transition hover:text-white"
                          onClick={() => toggle(workspace.id)}
                          aria-label={open ? "Collapse workspace" : "Expand workspace"}
                          title={open ? "Collapse workspace" : "Expand workspace"}
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => choose(workspace)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold shadow-[var(--omnix-glow-xs)]"
                            style={{ borderColor: color, background: `${color}18`, color }}
                          >
                            {workspace.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-white">{workspace.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[var(--omnix-text-3)]">
                              {liveStatus?.active_count ?? 0} active - {liveStatus?.source_count ?? 0} sources
                            </span>
                          </span>
                        </button>
                      </div>

                      {open ? (
                        <div className="ml-5 mt-2 space-y-1.5 border-l border-cyan-300/15 pl-3">
                          {(workspace.subspaces ?? []).length ? (workspace.subspaces ?? []).map((subspace, childIndex) => {
                            const active = selected?.id === subspace.id;
                            const color = workspaceColor(index + childIndex + 1);
                            const childStatus = statusForWorkspace(subspace.id);
                            return (
                              <button
                                key={subspace.id}
                                type="button"
                                onClick={() => choose(subspace)}
                                className={cn(
                                  "relative flex w-full items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left transition",
                                  active
                                    ? "shadow-[var(--omnix-glow-xs)]"
                                    : "border-transparent hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]",
                                )}
                                style={{
                                  background: active ? `${color}10` : "transparent",
                                  borderColor: active ? `${color}44` : undefined,
                                }}
                              >
                                <span className="absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2 bg-cyan-300/15" />
                                <span className="flex h-6 w-6 items-center justify-center rounded-md border text-[10px] font-bold" style={{ background: `${color}13`, borderColor: `${color}33`, color }}>
                                  {subspace.name.charAt(0).toUpperCase()}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium text-[var(--omnix-text)]">{subspace.name}</span>
                                  <span className="block truncate text-[10px] text-[var(--omnix-text-3)]">
                                    {childStatus?.active_count ?? 0} active - {childStatus?.source_count ?? 0} sources
                                  </span>
                                </span>
                              </button>
                            );
                          }) : (
                            <div className="rounded-[7px] border border-dashed border-[var(--omnix-border)] px-2.5 py-2 text-[11px] text-[var(--omnix-text-3)]">
                              No subspaces yet
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => openSubspaceCreator(workspace.id)}
                            className="flex w-full items-center gap-1.5 rounded-[7px] border border-dashed border-[var(--omnix-border)] px-2.5 py-1.5 text-left text-[11px] text-[var(--omnix-text-3)] transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-[var(--omnix-cyan)]"
                          >
                            <Plus className="h-3 w-3" />
                            Add subworkspace
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <div className="space-y-5">
            <WorkspaceIntelligencePanel profile={activeWorkspaceIntelligence} error={intelligenceError} />
            <WorkspacePresenceCluster
              presence={presence}
              workspaceName={selected?.name}
            />

            <section className="omnix-glass-band p-5 sm:p-6">
              <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 flex-col gap-4 min-[390px]:flex-row">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border shadow-[var(--omnix-glow-md)]"
                    style={{ borderColor: selectedColor, background: `${selectedColor}15`, color: selectedColor }}
                  >
                    <DetailIcon className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="omnix-display text-xl font-semibold text-white sm:text-2xl">
                        {selected?.name ?? "Workspace"}
                      </h2>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                        style={{ borderColor: `${selectedColor}44`, background: `${selectedColor}14`, color: selectedColor }}
                      >
                        {selected?.parent_workspace_id ? "Subspace" : "Workspace"}
                      </span>
                      {selected ? (
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", workspaceRoleBadgeClass(selected.current_user_role))}>
                          {workspaceRoleLabel(selected.current_user_role)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--omnix-text-2)]">
                      {selected?.description || "No workspace description set."}
                    </p>
                    {selected ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <WorkspaceMemberStack
                          members={members}
                          totalCount={selected.member_count}
                          size="md"
                          presenceMembers={presence?.recently_active_members ?? []}
                          showPresence
                        />
                        <span className="rounded-full border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 py-1 text-xs text-[var(--omnix-text-2)]">
                          {selected.member_count} {selected.member_count === 1 ? "member" : "members"}
                        </span>
                        {selected.is_shared ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                            <Check className="h-3 w-3" />
                            Shared
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1 sm:flex-none"
                    leftIcon={<Settings className="h-4 w-4" />}
                    onClick={() => router.push("/settings/workspace")}
                  >
                    Settings
                  </Button>
                    <Button
                      type="button"
                      className="omnix-primary-action flex-1 sm:flex-none"
                    leftIcon={<MessageSquare className="h-4 w-4" />}
                    onClick={() => router.push("/chat")}
                  >
                    Open
                  </Button>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {workspaceMetrics.map((metric) => {
                const Icon = metric.icon;
                return (
                  <article key={metric.label} className="omnix-metric-card p-4" style={{ "--metric-color": metric.color } as CSSProperties}>
                    <div className="relative z-10 flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--omnix-border)]" style={{ background: `${metric.color}14` }}>
                        <Icon className="h-4 w-4" style={{ color: metric.color }} />
                      </span>
                      <Sparkles className="h-3.5 w-3.5 text-[var(--omnix-text-3)]" />
                    </div>
                    <div className="relative z-10 mt-4">
                      <div className="omnix-display text-2xl font-bold text-white">{metric.value}</div>
                      <div className="mt-1 text-xs text-[var(--omnix-text-3)]">{metric.label}</div>
                    </div>
                  </article>
                );
              })}
            </div>

            <WorkspaceActivityFeed activity={activity} loading={loadingActivity} compact />

            <section className="omnix-glass-band p-5 sm:p-6">
                <div className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h3 className="omnix-display flex items-center gap-2 text-lg font-semibold text-white">
                    <History className="h-4 w-4 text-[var(--omnix-cyan)]" />
                    Operational Continuity
                  </h3>
                  <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Organizational progression and active initiatives.</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                  <Activity className="h-4 w-4 text-cyan-400" />
                </div>
              </div>
              <WorkspaceOperationalTimeline 
                events={timeline} 
                initiatives={initiatives} 
                loading={loadingContinuity} 
              />
            </section>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="omnix-section-card p-5">
                <div className="relative z-10 mb-4 flex items-center justify-between">
                  <h3 className="omnix-display flex items-center gap-2 text-lg font-semibold text-white">
                    <Zap className="h-4 w-4 text-[var(--omnix-cyan)]" />
                    Real Subspaces
                  </h3>
                  <span className="text-xs text-[var(--omnix-text-3)]">Loaded from workspace hierarchy</span>
                </div>
                <div className="relative z-10 grid gap-3 md:grid-cols-3">
                  {(selected?.subspaces ?? []).length ? (selected?.subspaces ?? []).map((subspace, index) => {
                    const color = workspaceColor(index + 1);
                    return (
                      <button
                        key={subspace.id}
                        type="button"
                        onClick={() => choose(subspace)}
                        className="omnix-command-button p-4 text-left"
                        style={{ "--command-color": color } as CSSProperties}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-bold" style={{ background: `${color}14`, borderColor: `${color}33`, color }}>
                          {subspace.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="mt-4 block text-sm font-semibold text-white">{subspace.name}</span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--omnix-text-3)]">
                          {subspace.description || "No description set."}
                        </span>
                      </button>
                    );
                  }) : (
                    <div className="col-span-full flex min-h-[150px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-6 text-center">
                      <Layers3 className="h-8 w-8 text-cyan-200/35" />
                      <p className="mt-3 text-sm font-semibold text-white">No subspaces yet</p>
                      <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--omnix-text-3)]">
                        Create a subworkspace to extend this workspace hierarchy.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-4 border-[var(--omnix-border)] bg-[var(--omnix-surface)]"
                        leftIcon={<Plus className="h-4 w-4" />}
                        disabled={!selected}
                        onClick={() => openSubspaceCreator(selected?.parent_workspace_id || selected?.id)}
                      >
                        Create subworkspace
                      </Button>
                    </div>
                  )}
                </div>
              </section>

              <aside className="omnix-section-card p-5">
                <div className="relative z-10 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300/30 bg-amber-300/10 text-amber-100">
                    {isWorkspaceFounderRole(selected?.current_user_role) ? <Crown className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Workspace Controls</h3>
                    <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Role-aware management stays connected to existing permissions.</p>
                  </div>
                </div>
                <div className="relative z-10 mt-4 space-y-2">
                  {[
                    { label: "Invite collaborators", href: "/team", icon: UserPlus },
                    { label: "Edit workspace identity", href: "/settings/workspace", icon: Settings },
                    { label: "Upload knowledge sources", href: "/sources", icon: Database },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => router.push(item.href)}
                        className="flex w-full items-center gap-3 rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 py-2.5 text-left text-sm text-[var(--omnix-text-2)] transition hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface)] hover:text-white hover:shadow-[var(--omnix-glow-xs)]"
                      >
                        <Icon className="h-4 w-4 text-[var(--omnix-cyan)]" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>

      {createOpen ? (
        <Portal>
          <div className="omnix-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4">
            <div className="omnix-modal-card w-full max-w-md p-5">
              <div className="relative z-10 flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-xs)]">
                    <Plus className="h-4 w-4" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-white">Create workspace</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">Add a new root workspace to the Omnix hierarchy.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Close create workspace modal"
                  title="Close create workspace modal"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <form className="relative z-10 mt-5 space-y-4" onSubmit={handleCreate}>
                <Input
                  id="workspace-name"
                  label="Workspace name"
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                    setCreateError(null);
                  }}
                  disabled={creating}
                  autoFocus
                />
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">Description</span>
                  <textarea
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                    disabled={creating}
                    rows={3}
                    className="omnix-input mt-2 w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="Main AI workspace for this team."
                  />
                </label>
                {createError ? (
                  <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                    {createError}
                  </div>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                    Cancel
                  </Button>
                  <Button type="submit" leftIcon={<Plus className="h-4 w-4" />} isLoading={creating} disabled={!newName.trim()}>
                    Create
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      ) : null}

      {subspaceOpen ? (
        <Portal>
          <div className="omnix-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4">
            <div className="omnix-modal-card w-full max-w-lg p-5">
              <div className="relative z-10 flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-xs)]">
                    <Layers3 className="h-4 w-4" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-white">Create subworkspace</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Add a real child workspace under an existing parent. It will appear in the hierarchy after creation.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Close create subworkspace modal"
                  title="Close create subworkspace modal"
                  onClick={() => setSubspaceOpen(false)}
                  disabled={creatingSubspace}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <form className="relative z-10 mt-5 space-y-4" onSubmit={handleCreateSubspace}>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">Parent workspace</span>
                  <select
                    value={subspaceParentId}
                    onChange={(event) => {
                      setSubspaceParentId(event.target.value);
                      setSubspaceError(null);
                    }}
                    disabled={creatingSubspace}
                    className="omnix-input h-11 w-full rounded-lg bg-black/20 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Choose parent</option>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  id="subworkspace-name"
                  label="Subworkspace name"
                  value={subspaceName}
                  onChange={(event) => {
                    setSubspaceName(event.target.value);
                    setSubspaceError(null);
                  }}
                  disabled={creatingSubspace}
                  autoFocus
                />
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">Description</span>
                  <textarea
                    value={subspaceDescription}
                    onChange={(event) => setSubspaceDescription(event.target.value)}
                    disabled={creatingSubspace}
                    rows={3}
                    className="omnix-input mt-2 w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="Focused space for a team, project, or knowledge domain."
                  />
                </label>
                {subspaceError ? (
                  <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                    {subspaceError}
                  </div>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setSubspaceOpen(false)} disabled={creatingSubspace}>
                    Cancel
                  </Button>
                  <Button type="submit" leftIcon={<Plus className="h-4 w-4" />} isLoading={creatingSubspace} disabled={!subspaceName.trim() || !subspaceParentId}>
                    Create subworkspace
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      ) : null}
    </section>
  );
}
