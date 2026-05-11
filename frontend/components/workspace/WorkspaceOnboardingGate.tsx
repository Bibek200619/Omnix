"use client";

import { useState, type FormEvent } from "react";
import { Plus, Users, Layers3, LogOut, Check, X, AlertCircle } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type WorkspaceOnboardingGateProps = {
  children: React.ReactNode;
};

export function WorkspaceOnboardingGate({ children }: WorkspaceOnboardingGateProps) {
  const {
    workspaces,
    loading,
    error,
    pendingInvites,
    acceptInvite,
    declineInvite,
    createWorkspace,
    refreshWorkspaces,
  } = useWorkspace();
  const { signOut } = useAuth();

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);

  // If loading or we have a valid workspace, we let the app render.
  // We ONLY show the gate if there are definitively 0 workspaces after loading,
  // OR if we are in a failure state where we can't load them and have none.
  const hasWorkspaces = workspaces.length > 0;
  const isBlocked = !loading && !hasWorkspaces;

  if (!isBlocked) {
    return <>{children}</>;
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
      await createWorkspace({
        name,
        description: newDescription.trim() || undefined,
      });
      // Context will automatically pick it up and unblock
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  async function handleAccept(inviteId: string) {
    try {
      setAcceptingId(inviteId);
      await acceptInvite(inviteId);
    } catch (err) {
      console.error(err);
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleDecline(inviteId: string) {
    try {
      setDecliningId(inviteId);
      await declineInvite(inviteId);
    } catch (err) {
      console.error(err);
    } finally {
      setDecliningId(null);
    }
  }

  return (
    <main className="omnix-app-bg flex min-h-[100dvh] items-start justify-center overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-white sm:items-center sm:py-8">
      <div className="relative z-10 w-full max-w-md space-y-5 sm:space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-[var(--omnix-cyan)] shadow-[0_0_24px_rgba(0,255,255,0.15)] sm:h-16 sm:w-16">
            <Layers3 className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Welcome to Omnix</h1>
          <p className="mt-2 text-sm text-[var(--omnix-text-2)]">
            Join or create a workspace to get started.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-center">
            <AlertCircle className="mx-auto mb-3 h-6 w-6 text-rose-400" />
            <p className="text-sm text-rose-200">{error}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 border-rose-500/30"
              onClick={() => refreshWorkspaces({ force: true })}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {pendingInvites.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--omnix-text)] flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--omnix-cyan)]" />
              Pending Invites
            </h2>
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="rounded-xl border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4 flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">{invite.email}</p>
                  <p className="text-xs text-[var(--omnix-text-3)] mt-1">Invited by {invite.invited_by || "a team member"}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="flex-1 bg-[var(--omnix-cyan)] text-black hover:bg-cyan-400"
                    onClick={() => handleAccept(invite.id)}
                    isLoading={acceptingId === invite.id}
                    disabled={acceptingId !== null || decliningId !== null}
                    leftIcon={<Check className="h-4 w-4" />}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1 hover:bg-rose-500/20 hover:text-rose-200"
                    onClick={() => handleDecline(invite.id)}
                    isLoading={decliningId === invite.id}
                    disabled={acceptingId !== null || decliningId !== null}
                    leftIcon={<X className="h-4 w-4" />}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4 py-3">
              <div className="h-px flex-1 bg-[var(--omnix-border)]" />
              <span className="text-xs text-[var(--omnix-text-3)] font-medium uppercase">Or</span>
              <div className="h-px flex-1 bg-[var(--omnix-border)]" />
            </div>
          </div>
        ) : null}

        {!error && (
          <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4 shadow-[var(--omnix-glow-sm)] sm:p-5">
            <div>
              <h2 className="text-sm font-semibold text-[var(--omnix-text)]">Create a new workspace</h2>
              <p className="text-xs text-[var(--omnix-text-3)] mt-1">Your personal area for collaboration and AI workflows.</p>
            </div>
            <Input
              id="workspace-name"
              label="Workspace Name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setCreateError(null);
              }}
              disabled={creating}
              autoFocus
              placeholder="e.g. Acme Corp, Design Team"
            />
            <label className="block">
              <span className="text-sm font-medium text-slate-200">Description (Optional)</span>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                disabled={creating}
                rows={2}
                className="omnix-input mt-2 w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="What is this workspace for?"
              />
            </label>
            {createError ? (
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                {createError}
              </div>
            ) : null}
            <Button
              type="submit"
              className="w-full omnix-primary-action h-11"
              isLoading={creating}
              disabled={!newName.trim()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Create Workspace
            </Button>
          </form>
        )}

        <div className="pt-4 text-center">
          <Button type="button" variant="ghost" className="text-xs text-[var(--omnix-text-3)] hover:text-white" onClick={() => signOut()}>
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
      </div>
    </main>
  );
}
