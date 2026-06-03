"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Check, GitBranch, Layers3, Loader2, Plus, Settings, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { Workspace } from "@/lib/workspace-types";
import type { WorkspaceFocus } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

function flattenWorkspaces(workspaces: Workspace[]) {
  const list: Workspace[] = [];
  const visit = (workspace: Workspace) => {
    list.push(workspace);
    workspace.subspaces?.forEach(visit);
  };
  workspaces.forEach(visit);
  return list;
}

function findWorkspace(workspaces: Workspace[], workspaceId?: string | null) {
  if (!workspaceId) return null;
  return flattenWorkspaces(workspaces).find((workspace) => workspace.id === workspaceId) ?? null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

const workspaceFocuses: Array<{ value: WorkspaceFocus; label: string; hint: string }> = [
  { value: "general", label: "General", hint: "Balanced collaborative intelligence" },
  { value: "engineering", label: "Engineering", hint: "Implementation, debugging, architecture, and scale" },
  { value: "design", label: "Design", hint: "UX psychology, hierarchy, interaction clarity, and flow" },
  { value: "research", label: "Research", hint: "Exploration, synthesis, evidence, and comparison" },
  { value: "strategy", label: "Strategy", hint: "Systems thinking, leverage, sequencing, and execution" },
];

export function WorkspaceSettingsPanel() {
  const {
    activeWorkspace,
    activeRootWorkspace,
    activeMembers,
    activeInvites,
    activeWorkspaceIntelligence,
    createSubspace,
    deleteWorkspace,
    renameWorkspace,
    setActiveWorkspace,
    updateWorkspaceIntelligence,
    workspaces,
  } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subspaceName, setSubspaceName] = useState("");
  const [subspaceDescription, setSubspaceDescription] = useState("");
  const [creatingSubspace, setCreatingSubspace] = useState(false);
  const [subspaceError, setSubspaceError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [expertiseArea, setExpertiseArea] = useState("");
  const [workspaceFocus, setWorkspaceFocus] = useState<WorkspaceFocus>("general");
  const [aiInstructions, setAiInstructions] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [savingIntelligence, setSavingIntelligence] = useState(false);
  const [intelligenceSaved, setIntelligenceSaved] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);

  const parentWorkspace = useMemo(
    () => findWorkspace(workspaces, activeWorkspace?.parent_workspace_id),
    [activeWorkspace?.parent_workspace_id, workspaces],
  );
  const visibleSubspaces = activeWorkspace?.subspaces ?? [];
  const canEdit = isWorkspaceFounderRole(activeWorkspace?.current_user_role);

  useEffect(() => {
    setName(activeWorkspace?.name ?? "");
    setDescription(activeWorkspace?.description ?? "");
    setError(null);
    setSaved(false);
    setSubspaceError(null);
    setDeleteError(null);
    setExpertiseArea(activeWorkspace?.expertise_area ?? "");
    setWorkspaceFocus(activeWorkspace?.workspace_focus ?? activeWorkspace?.ai_specialization ?? "general");
    setAiInstructions(activeWorkspace?.ai_instructions ?? "");
    setMemoryEnabled(activeWorkspace?.intelligence_preferences?.memory_enabled !== false);
    setIntelligenceError(null);
    setIntelligenceSaved(false);
  }, [activeWorkspace]);

  async function saveWorkspace() {
    if (!activeWorkspace) return;
    const nextName = name.trim();
    if (!nextName) {
      setError("Workspace name cannot be empty.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await renameWorkspace(activeWorkspace.id, {
        name: nextName,
        description: description.trim() || null,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      logClientError("Failed to update workspace", err, { endpoint: `/workspaces/${activeWorkspace.id}` });
      setError("Unable to update workspace.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateSubspace() {
    if (!activeWorkspace) return;
    const nextName = subspaceName.trim();
    if (!nextName) {
      setSubspaceError("Subworkspace name is required.");
      return;
    }

    try {
      setCreatingSubspace(true);
      setSubspaceError(null);
      const created = await createSubspace(activeWorkspace.parent_workspace_id ? activeWorkspace.parent_workspace_id : activeWorkspace.id, {
        name: nextName,
        description: subspaceDescription.trim() || undefined,
      });
      setSubspaceName("");
      setSubspaceDescription("");
      setActiveWorkspace(created.id);
    } catch (err) {
      logClientError("Failed to create subworkspace", err);
      setSubspaceError("Unable to create subworkspace.");
    } finally {
      setCreatingSubspace(false);
    }
  }

  async function handleDeleteWorkspace() {
    if (!activeWorkspace || !canEdit) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      await deleteWorkspace(activeWorkspace.id);
    } catch (err) {
      logClientError("Failed to delete workspace", err, { endpoint: `/workspaces/${activeWorkspace.id}` });
      setDeleteError("Unable to delete workspace.");
    } finally {
      setDeleting(false);
    }
  }

  async function saveIntelligence() {
    if (!activeWorkspace) return;
    try {
      setSavingIntelligence(true);
      setIntelligenceError(null);
      await updateWorkspaceIntelligence({
        expertise_area: expertiseArea.trim() || null,
        workspace_focus: workspaceFocus,
        ai_specialization: workspaceFocus,
        ai_instructions: aiInstructions.trim() || null,
        intelligence_preferences: {
          ...(activeWorkspaceIntelligence?.intelligence_preferences ?? activeWorkspace.intelligence_preferences ?? {}),
          memory_enabled: memoryEnabled,
          retrieval_scope: activeWorkspace.is_global ? "global" : "workspace",
          source_permissions: activeWorkspace.is_global ? "organization" : "workspace_only",
        },
      });
      setIntelligenceSaved(true);
      window.setTimeout(() => setIntelligenceSaved(false), 2200);
    } catch (err) {
      logClientError("Failed to update intelligence profile", err, { endpoint: `/workspaces/${activeWorkspace.id}/intelligence` });
      setIntelligenceError("Unable to update intelligence profile.");
    } finally {
      setSavingIntelligence(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="omnix-cinematic-card border-dashed p-6 text-sm text-[var(--omnix-text-2)]">
        Select a workspace from the sidebar before editing workspace settings.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="omnix-cinematic-card overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute right-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-cyan-300/10 blur-[90px]" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 shadow-[var(--omnix-glow-sm)]">
                <Settings className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Control center</p>
                <h3 className="omnix-display mt-1 text-2xl font-semibold text-white">{activeWorkspace.name}</h3>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--omnix-text-2)]">
              Manage identity, hierarchy, access, and workspace-level preferences for the active workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", workspaceRoleBadgeClass(activeWorkspace.current_user_role))}>
              {workspaceRoleLabel(activeWorkspace.current_user_role)}
            </span>
            <span className="rounded-full border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 py-1 text-xs text-[var(--omnix-text-2)]">
              {activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="omnix-cinematic-card p-5">
          <div className="relative z-10 mb-5 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-cyan-200" />
            <div>
              <h3 className="font-semibold text-white">Workspace identity</h3>
              <p className="mt-1 text-sm text-[var(--omnix-text-3)]">Name and description are saved to the backend workspace record.</p>
            </div>
          </div>

          <div className="relative z-10 grid gap-4">
            <Input
              label="Workspace name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
              disabled={!canEdit || saving}
            />
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Description</span>
              <textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit || saving}
                rows={4}
                className="omnix-input mt-2 w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="What is this workspace for?"
              />
            </label>
          </div>

          {!canEdit ? (
            <Alert className="mt-5" variant="warning" title="Workspace edits are founder-only">
              You can collaborate here, but only the workspace founder can rename or edit details.
            </Alert>
          ) : null}
          {error ? (
            <Alert className="mt-5" variant="error" title="Workspace update failed">
              {error}
            </Alert>
          ) : null}
          {saved ? (
            <Alert className="mt-5" variant="success" title="Saved">
              Workspace settings updated.
            </Alert>
          ) : null}

          <div className="relative z-10 mt-6 flex justify-end">
            <Button
              type="button"
              leftIcon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              isLoading={saving}
              disabled={!canEdit || !name.trim()}
              onClick={saveWorkspace}
            >
              Save workspace
            </Button>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="omnix-cinematic-card p-5">
            <div className="relative z-10 mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <GitBranch className="h-4 w-4 text-[var(--omnix-cyan)]" />
              Hierarchy
            </div>
            <div className="relative z-10 grid gap-3">
              <InfoRow 
                label="Workspace type" 
                value={
                  activeWorkspace.workspace_type === "super_workspace" || activeWorkspace.workspace_type === "super" ? "Super Workspace" :
                  activeWorkspace.workspace_type === "subworkspace" || activeWorkspace.workspace_type === "sub" ? "Subworkspace" :
                  activeWorkspace.workspace_type === "global_workspace" ? "Global Space" :
                  activeWorkspace.workspace_type
                } 
              />
              <InfoRow label="Parent workspace" value={parentWorkspace?.name ?? "Root workspace"} />
              <InfoRow label="Root workspace" value={activeRootWorkspace?.name ?? activeWorkspace.name} />
              <InfoRow label="Global space" value={activeWorkspace.is_global ? "Global" : "Standard"} />
            </div>
          </div>

          <div className="omnix-cinematic-card p-5">
            <div className="relative z-10 mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4 text-[var(--omnix-green)]" />
              Access summary
            </div>
            <div className="relative z-10 grid gap-3">
              <InfoRow label="Loaded members" value={String(activeMembers.length)} />
              <InfoRow label="Pending invites" value={String(activeInvites.filter((invite) => invite.status === "pending").length)} />
              <InfoRow label="Visibility" value={activeWorkspace.is_shared ? "Shared" : "Private"} />
            </div>
          </div>
        </aside>
      </div>

      <section className="omnix-cinematic-card p-5">
        <div className="relative z-10 mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <BrainCircuit className="h-4 w-4 text-cyan-200" />
              Workspace cognition
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--omnix-text-3)]">
              Define the cognitive posture Omnix should use inside this workspace. It shapes chat, continuity, and retrieval-aware reasoning without changing Omnix identity.
            </p>
          </div>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {activeWorkspaceIntelligence?.source_count ?? 0} sources active
          </span>
        </div>

        <div className="relative z-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium text-slate-300">Cognitive focus</div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {workspaceFocuses.map((focus) => (
                  <button
                    key={focus.value}
                    type="button"
                    disabled={!canEdit || savingIntelligence}
                    onClick={() => setWorkspaceFocus(focus.value)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                      workspaceFocus === focus.value
                        ? "border-cyan-300/35 bg-cyan-300/10 shadow-[var(--omnix-glow-xs)]"
                        : "border-[var(--omnix-border)] bg-black/15 hover:border-[var(--omnix-border-active)]",
                    )}
                  >
                    <span className="block text-sm font-semibold text-white">{focus.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--omnix-text-3)]">{focus.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-slate-300">Expertise area</span>
              <textarea
                value={expertiseArea}
                onChange={(event) => {
                  setExpertiseArea(event.target.value);
                  setIntelligenceSaved(false);
                }}
                disabled={!canEdit || savingIntelligence}
                rows={3}
                className="omnix-input mt-2 w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="UI systems, APIs, launch strategy, operations..."
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-300">Workspace instructions</span>
              <textarea
                value={aiInstructions}
                onChange={(event) => {
                  setAiInstructions(event.target.value);
                  setIntelligenceSaved(false);
                }}
                disabled={!canEdit || savingIntelligence}
                rows={5}
                className="omnix-input mt-2 w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Tell Omnix how to answer for this workspace, what standards to follow, and what context matters."
              />
            </label>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-[var(--omnix-border)] bg-black/15 p-4">
              <div className="text-sm font-semibold text-white">Memory controls</div>
              <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">
                Source retrieval remains workspace-scoped by default. Global spaces can use organization-wide scope.
              </p>
              <div className="mt-4">
                <Toggle
                  label="Workspace memory"
                  description="Include workspace profile and continuity context."
                  checked={memoryEnabled}
                  disabled={!canEdit || savingIntelligence}
                  onChange={(event) => setMemoryEnabled(event.target.checked)}
                />
              </div>
              <div className="mt-4 grid gap-2 text-xs text-[var(--omnix-text-2)]">
                <InfoRow label="Retrieval scope" value={activeWorkspace.is_global ? "Global" : "Workspace"} />
                <InfoRow label="Detected domains" value={(activeWorkspaceIntelligence?.active_domains ?? []).slice(0, 2).join(", ") || "None yet"} />
              </div>
            </div>
          </aside>
        </div>

        {intelligenceError ? (
          <Alert className="mt-5" variant="error" title="Intelligence update failed">
            {intelligenceError}
          </Alert>
        ) : null}
        {intelligenceSaved ? (
          <Alert className="mt-5" variant="success" title="Workspace cognition saved">
            Workspace cognitive routing is updated.
          </Alert>
        ) : null}

        <div className="relative z-10 mt-6 flex justify-end">
          <Button
            type="button"
            leftIcon={savingIntelligence ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
            isLoading={savingIntelligence}
            disabled={!canEdit}
            onClick={saveIntelligence}
          >
            Save workspace cognition
          </Button>
        </div>
      </section>

      <section className="omnix-cinematic-card p-5">
        <div className="relative z-10 mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Layers3 className="h-4 w-4 text-[var(--omnix-purple)]" />
              Subworkspace management
            </div>
            <p className="mt-1 text-sm text-[var(--omnix-text-3)]">
              Create and review real child workspaces attached to this hierarchy.
            </p>
          </div>
          <span className="rounded-full border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 py-1 text-xs text-[var(--omnix-text-2)]">
            {visibleSubspaces.length} subworkspace{visibleSubspaces.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="relative z-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-2">
            {visibleSubspaces.length ? (
              visibleSubspaces.map((subspace) => (
                <button
                  key={subspace.id}
                  type="button"
                  onClick={() => setActiveWorkspace(subspace.id)}
                  className="flex items-center gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-3 text-left transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-purple-300/25 bg-purple-300/10 text-sm font-bold text-purple-100">
                    {subspace.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">{subspace.name}</span>
                    <span className="block truncate text-xs text-[var(--omnix-text-3)]">{subspace.description || "No description set."}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-6 text-center">
                <Layers3 className="mx-auto h-8 w-8 text-cyan-200/35" />
                <p className="mt-3 text-sm font-semibold text-white">No subworkspaces yet</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--omnix-text-3)]">
                  Create the first subworkspace to segment teams, projects, or knowledge domains.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--omnix-border)] bg-black/15 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Plus className="h-4 w-4 text-cyan-200" />
              New subworkspace
            </div>
            <div className="space-y-3">
              <Input
                label="Name"
                value={subspaceName}
                onChange={(event) => {
                  setSubspaceName(event.target.value);
                  setSubspaceError(null);
                }}
                disabled={!canEdit || creatingSubspace}
              />
              <textarea
                value={subspaceDescription}
                onChange={(event) => setSubspaceDescription(event.target.value)}
                disabled={!canEdit || creatingSubspace}
                rows={3}
                className="omnix-input w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Purpose or scope"
              />
              {subspaceError ? (
                <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                  {subspaceError}
                </div>
              ) : null}
              <Button
                type="button"
                className="w-full"
                leftIcon={<Plus className="h-4 w-4" />}
                isLoading={creatingSubspace}
                disabled={!canEdit || !subspaceName.trim()}
                onClick={handleCreateSubspace}
              >
                Create subworkspace
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="omnix-cinematic-card p-5">
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-amber-200" />
              Workspace preferences
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--omnix-text-3)]">
              Preferences are currently derived from the workspace record and role permissions. Backend-backed preference switches can be added here without changing the page structure.
            </p>
          </div>
          <div className="grid gap-2 text-xs text-[var(--omnix-text-2)] sm:grid-cols-2">
            <span className="rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 py-2">Role-aware controls</span>
            <span className="rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 py-2">Inherited subspace access</span>
          </div>
        </div>
      </section>

      {canEdit ? (
        <section className="rounded-[var(--omnix-radius)] border border-rose-400/20 bg-rose-400/[0.045] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-rose-100">
                <Trash2 className="h-4 w-4" />
                Danger zone
              </div>
              <p className="mt-1 text-sm text-rose-100/65">Delete this workspace only when you are sure it is no longer needed.</p>
              {deleteError ? <p className="mt-2 text-xs text-rose-100">{deleteError}</p> : null}
            </div>
            <Button
              type="button"
              variant="danger"
              leftIcon={<Trash2 className="h-4 w-4" />}
              isLoading={deleting}
              onClick={handleDeleteWorkspace}
            >
              Delete workspace
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
