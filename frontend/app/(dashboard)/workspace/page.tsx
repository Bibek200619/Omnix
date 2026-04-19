"use client";

import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Crown,
  Database,
  Globe2,
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
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import {
  isWorkspaceFounderRole,
  workspaceRoleBadgeClass,
  workspaceRoleLabel,
} from "@/lib/workspace-roles";
import type { Workspace } from "@/lib/workspace-types";

type SpaceKey = "root" | "global" | "team" | "knowledge";

const childSpaces: Array<{
  key: Exclude<SpaceKey, "root">;
  label: string;
  desc: string;
  color: string;
  icon: LucideIcon;
  href: string;
}> = [
  {
    key: "global",
    label: "Global",
    desc: "Shared workspace memory and active AI sessions",
    color: "var(--omnix-cyan)",
    icon: Globe2,
    href: "/chat",
  },
  {
    key: "team",
    label: "Team",
    desc: "Members, roles, invites, and presence",
    color: "var(--omnix-amber)",
    icon: Users,
    href: "/team",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    desc: "Uploaded sources and retrieval context",
    color: "var(--omnix-green)",
    icon: Database,
    href: "/sources",
  },
];

function workspaceColor(index: number) {
  return ["var(--omnix-cyan)", "var(--omnix-purple)", "var(--omnix-green)", "var(--omnix-amber)", "var(--omnix-pink)"][index % 5];
}

function selectionId(workspaceId: string, key: SpaceKey) {
  return `${workspaceId}:${key}`;
}

function selectedWorkspace(workspaces: Workspace[], selectedId: string | null, fallback: Workspace | null) {
  if (!selectedId) return fallback;
  const [workspaceId] = selectedId.split(":");
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? fallback;
}

function selectedSpaceKey(selectedId: string | null): SpaceKey {
  if (!selectedId) return "root";
  const key = selectedId.split(":")[1];
  return key === "global" || key === "team" || key === "knowledge" ? key : "root";
}

export default function WorkspacePage() {
  const router = useRouter();
  const {
    activeWorkspace,
    activeWorkspaceId,
    activeMembers,
    activeInvites,
    createWorkspace,
    loading,
    setActiveWorkspace,
    workspaces,
  } = useWorkspace();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    activeWorkspaceId ? selectionId(activeWorkspaceId, "root") : null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const selected = selectedWorkspace(workspaces, selectedId, activeWorkspace);
  const selectedKey = selectedSpaceKey(selectedId);
  const selectedChild = childSpaces.find((space) => space.key === selectedKey) ?? null;
  const DetailIcon = selectedChild?.icon ?? Layers3;
  const selectedIndex = selected ? Math.max(0, workspaces.findIndex((workspace) => workspace.id === selected.id)) : 0;
  const selectedColor = selectedChild?.color ?? workspaceColor(selectedIndex);
  const members = activeMembers.length > 0 ? activeMembers : selected?.members_preview ?? [];
  const selectedMemberCount = selected?.member_count ?? members.length;

  const workspaceMetrics = useMemo(
    () => [
      { label: "Members", value: selectedMemberCount || 1, icon: Users, color: selectedColor },
      { label: "Spaces", value: childSpaces.length, icon: Layers3, color: "var(--omnix-purple)" },
      { label: "Sources", value: "Live", icon: Database, color: "var(--omnix-green)" },
      { label: "Invites", value: activeInvites.length || "Clear", icon: UserPlus, color: "var(--omnix-amber)" },
    ],
    [activeInvites.length, selectedColor, selectedMemberCount],
  );

  function toggle(workspaceId: string) {
    setExpanded((current) => ({ ...current, [workspaceId]: !(current[workspaceId] ?? true) }));
  }

  function choose(workspace: Workspace, key: SpaceKey) {
    setSelectedId(selectionId(workspace.id, key));
    setActiveWorkspace(workspace.id);
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
      setSelectedId(selectionId(created.id, "root"));
      setExpanded((current) => ({ ...current, [created.id]: true }));
      setNewName("");
      setNewDescription("");
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create workspace.");
    } finally {
      setCreating(false);
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
            className="omnix-primary-action h-11 rounded-[9px] px-4"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            New workspace
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
                  const rootActive = selected?.id === workspace.id && selectedKey === "root";

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
                          onClick={() => choose(workspace, "root")}
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
                              {workspace.member_count} members - {workspace.is_shared ? "shared" : "private"}
                            </span>
                          </span>
                        </button>
                      </div>

                      {open ? (
                        <div className="ml-5 mt-2 space-y-1.5 border-l border-cyan-300/15 pl-3">
                          {childSpaces.map((space) => {
                            const active = selected?.id === workspace.id && selectedKey === space.key;
                            const Icon = space.icon;
                            return (
                              <button
                                key={space.key}
                                type="button"
                                onClick={() => choose(workspace, space.key)}
                                className={cn(
                                  "relative flex w-full items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left transition",
                                  active
                                    ? "shadow-[var(--omnix-glow-xs)]"
                                    : "border-transparent hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]",
                                )}
                                style={{
                                  background: active ? `${space.color}10` : "transparent",
                                  borderColor: active ? `${space.color}44` : undefined,
                                }}
                              >
                                <span className="absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2 bg-cyan-300/15" />
                                <span className="flex h-6 w-6 items-center justify-center rounded-md border" style={{ background: `${space.color}13`, borderColor: `${space.color}33` }}>
                                  <Icon className="h-3.5 w-3.5" style={{ color: space.color }} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium text-[var(--omnix-text)]">{space.label}</span>
                                  <span className="block truncate text-[10px] text-[var(--omnix-text-3)]">{space.desc}</span>
                                </span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => router.push("/settings/workspace")}
                            className="flex w-full items-center gap-1.5 rounded-[7px] border border-dashed border-[var(--omnix-border)] px-2.5 py-1.5 text-left text-[11px] text-[var(--omnix-text-3)] transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-[var(--omnix-cyan)]"
                          >
                            <Plus className="h-3 w-3" />
                            Configure hierarchy
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
            <section className="omnix-glass-band p-5 sm:p-6">
              <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border shadow-[var(--omnix-glow-md)]"
                    style={{ borderColor: selectedColor, background: `${selectedColor}15`, color: selectedColor }}
                  >
                    <DetailIcon className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="omnix-display text-2xl font-semibold text-white">
                        {selectedChild ? selectedChild.label : selected?.name ?? "Workspace"}
                      </h2>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                        style={{ borderColor: `${selectedColor}44`, background: `${selectedColor}14`, color: selectedColor }}
                      >
                        {selectedChild ? "Subspace" : "Super Workspace"}
                      </span>
                      {!selectedChild && selected ? (
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", workspaceRoleBadgeClass(selected.current_user_role))}>
                          {workspaceRoleLabel(selected.current_user_role)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--omnix-text-2)]">
                      {selectedChild?.desc || selected?.description || "Root workspace for shared AI sessions, sources, members, and operational context."}
                    </p>
                    {selected ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <WorkspaceMemberStack members={members} totalCount={selected.member_count} size="md" />
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<Settings className="h-4 w-4" />}
                    onClick={() => router.push("/settings/workspace")}
                  >
                    Settings
                  </Button>
                  <Button
                    type="button"
                    className="omnix-primary-action"
                    leftIcon={selectedChild ? <Globe2 className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                    onClick={() => router.push(selectedChild?.href ?? "/chat")}
                  >
                    Open
                  </Button>
                </div>
              </div>
            </section>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="omnix-section-card p-5">
                <div className="relative z-10 mb-4 flex items-center justify-between">
                  <h3 className="omnix-display flex items-center gap-2 text-lg font-semibold text-white">
                    <Zap className="h-4 w-4 text-[var(--omnix-cyan)]" />
                    Subspace Matrix
                  </h3>
                  <span className="text-xs text-[var(--omnix-text-3)]">Inherited from root workspace</span>
                </div>
                <div className="relative z-10 grid gap-3 md:grid-cols-3">
                  {childSpaces.map((space) => {
                    const Icon = space.icon;
                    return (
                      <button
                        key={space.key}
                        type="button"
                        onClick={() => selected && choose(selected, space.key)}
                        className="omnix-command-button p-4 text-left"
                        style={{ "--command-color": space.color } as CSSProperties}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ background: `${space.color}14`, borderColor: `${space.color}33` }}>
                          <Icon className="h-4 w-4" style={{ color: space.color }} />
                        </span>
                        <span className="mt-4 block text-sm font-semibold text-white">{space.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--omnix-text-3)]">{space.desc}</span>
                      </button>
                    );
                  })}
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
      ) : null}
    </section>
  );
}
