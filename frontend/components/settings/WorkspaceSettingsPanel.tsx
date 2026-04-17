"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Settings } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useWorkspace } from "@/lib/workspace-context";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";

export function WorkspaceSettingsPanel() {
  const { activeWorkspace, renameWorkspace } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(activeWorkspace?.name ?? "");
    setDescription(activeWorkspace?.description ?? "");
    setError(null);
    setSaved(false);
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
      setError(err instanceof Error ? err.message : "Unable to update workspace.");
    } finally {
      setSaving(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="omnix-cinematic-card border-dashed p-6 text-sm text-[var(--omnix-text-2)]">
        Select a workspace from the sidebar before editing workspace settings.
      </div>
    );
  }

  const canEdit = isWorkspaceFounderRole(activeWorkspace.current_user_role);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="omnix-cinematic-card p-5">
        <div className="relative z-10 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">Workspace identity</h3>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              These settings belong to the active workspace only. Account profile data lives separately.
            </p>
          </div>
        </div>

        <div className="relative z-10 mt-6 grid gap-4">
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
          <div className="relative z-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Current workspace</p>
          <h3 className="mt-2 truncate text-lg font-semibold text-white">{activeWorkspace.name}</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", workspaceRoleBadgeClass(activeWorkspace.current_user_role))}>
              {workspaceRoleLabel(activeWorkspace.current_user_role)}
            </span>
            <span className="rounded-full border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2.5 py-1 text-xs text-[var(--omnix-text-2)]">
              {activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"}
            </span>
          </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
