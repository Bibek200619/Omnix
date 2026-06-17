"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Layers3,
  LogOut,
  Mail,
  Plus,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useWorkspace } from "@/lib/workspace-context";
import type { Workspace, WorkspaceFocus, WorkspaceInvite } from "@/lib/workspace-types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import type { MessageAttachment } from "@/components/chat/types";
import { cn } from "@/lib/utils";

type WorkspaceOnboardingGateProps = {
  children: ReactNode;
};

type StepId = "account" | "workspace" | "team" | "knowledge" | "done";

type StepDefinition = {
  id: StepId;
  label: string;
  description: string;
  icon: LucideIcon;
};

const steps: StepDefinition[] = [
  { id: "account", label: "Account", description: "Confirm your signed-in identity.", icon: UserCircle },
  { id: "workspace", label: "Workspace", description: "Create or join a real workspace.", icon: Layers3 },
  { id: "team", label: "Team", description: "Optionally invite collaborators.", icon: Users },
  { id: "knowledge", label: "Knowledge", description: "Optionally upload first sources.", icon: FileText },
  { id: "done", label: "Done", description: "Enter the operating surface.", icon: CheckCircle2 },
];

const focusOptions: Array<{ value: WorkspaceFocus; label: string; description: string }> = [
  { value: "general", label: "General", description: "Balanced workspace intelligence." },
  { value: "engineering", label: "Engineering", description: "Technical planning and implementation." },
  { value: "design", label: "Design", description: "Product, UX, and interface thinking." },
  { value: "research", label: "Research", description: "Analysis, sources, and evidence." },
  { value: "strategy", label: "Strategy", description: "Roadmaps, tradeoffs, and decisions." },
];

function activeWorkspaceFromList(workspaces: Workspace[], workspaceId: string | null) {
  if (!workspaceId) return null;

  const stack = [...workspaces];
  while (stack.length) {
    const workspace = stack.shift();
    if (!workspace) continue;
    if (workspace.id === workspaceId) return workspace;
    stack.push(...(workspace.subspaces ?? []));
  }

  return null;
}

function userLabel(email?: string | null) {
  return email || "Authenticated account";
}

function inviteLabel(invite: WorkspaceInvite) {
  return invite.workspace_name || invite.email || "Workspace invitation";
}

export function WorkspaceOnboardingGate({ children }: WorkspaceOnboardingGateProps) {
  const {
    workspaces,
    loading,
    error,
    activeWorkspace,
    activeWorkspaceId,
    pendingInvites,
    acceptInvite,
    declineInvite,
    createWorkspace,
    refreshWorkspaces,
    refreshActiveWorkspaceData,
    setActiveWorkspace,
  } = useWorkspace();
  const { user, signOut } = useAuth();

  const [onboardingStarted, setOnboardingStarted] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [step, setStep] = useState<StepId>("account");
  const [onboardingWorkspaceId, setOnboardingWorkspaceId] = useState<string | null>(null);

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceFocus, setWorkspaceFocus] = useState<WorkspaceFocus>("general");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sentInvites, setSentInvites] = useState<string[]>([]);

  const [uploadedSources, setUploadedSources] = useState<string[]>([]);

  const hasWorkspaces = workspaces.length > 0;
  const workspaceLoadFailed = !loading && Boolean(error) && !hasWorkspaces;
  const onboardingWorkspace = useMemo(
    () =>
      activeWorkspaceFromList(workspaces, onboardingWorkspaceId) ||
      activeWorkspace ||
      activeWorkspaceFromList(workspaces, activeWorkspaceId),
    [activeWorkspace, activeWorkspaceId, onboardingWorkspaceId, workspaces],
  );
  const currentStepIndex = steps.findIndex((item) => item.id === step);
  const hasWorkspaceForFlow = Boolean(onboardingWorkspace);

  useEffect(() => {
    if (!loading && !hasWorkspaces && !error) {
      setOnboardingStarted(true);
    }
    if (workspaceLoadFailed) {
      setOnboardingStarted(true);
      setStep("workspace");
    }
  }, [error, hasWorkspaces, loading, workspaceLoadFailed]);

  const isBlocked = !loading && (workspaceLoadFailed || !hasWorkspaces || (onboardingStarted && !onboardingComplete));
  const onboardingTrapRef = useFocusTrap<HTMLElement>(isBlocked);

  if (!isBlocked) {
    return <>{children}</>;
  }

  function goTo(nextStep: StepId, options?: { allowPendingWorkspace?: boolean }) {
    const nextIndex = steps.findIndex((item) => item.id === nextStep);
    if (nextIndex > 1 && !hasWorkspaceForFlow && !options?.allowPendingWorkspace) {
      setStep("workspace");
      return;
    }
    setStep(nextStep);
  }

  function setWorkspace(workspace: Workspace) {
    setOnboardingWorkspaceId(workspace.id);
    setActiveWorkspace(workspace.id);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) {
      setCreateError("Workspace name is required.");
      return;
    }

    try {
      setCreating(true);
      setCreateError(null);
      const workspace = await createWorkspace({
        name,
        description: workspaceDescription.trim() || undefined,
        workspace_focus: workspaceFocus,
      });
      setWorkspace(workspace);
      await refreshWorkspaces({ force: true, silent: true });
      goTo("team", { allowPendingWorkspace: true });
    } catch (err) {
      logClientError("Failed to create onboarding workspace", err, { endpoint: "/workspaces" });
      setCreateError("Unable to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  async function handleAccept(inviteId: string) {
    try {
      setAcceptingId(inviteId);
      const workspace = await acceptInvite(inviteId);
      setWorkspace(workspace);
      goTo("team", { allowPendingWorkspace: true });
    } catch (err) {
      logClientError("Failed to accept onboarding invite", err, { endpoint: `/workspace-invites/${inviteId}/accept` });
      setCreateError("Unable to accept invite.");
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleDecline(inviteId: string) {
    try {
      setDecliningId(inviteId);
      await declineInvite(inviteId);
    } catch (err) {
      logClientError("Failed to decline onboarding invite", err, { endpoint: `/workspace-invites/${inviteId}/decline` });
      setCreateError("Unable to decline invite.");
    } finally {
      setDecliningId(null);
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    const workspaceId = onboardingWorkspace?.id;
    if (!workspaceId) {
      setInviteError("Create or join a workspace first.");
      return;
    }
    if (!email) {
      setInviteError("Enter an email address to invite.");
      return;
    }

    try {
      setInviting(true);
      setInviteError(null);
      await apiClient.post<WorkspaceInvite>(`/workspaces/${workspaceId}/invites`, {
        email,
        role: "member",
      });
      setSentInvites((current) => [email, ...current.filter((item) => item !== email)]);
      setInviteEmail("");
      await refreshActiveWorkspaceData({ force: true, silent: true });
    } catch (err) {
      logClientError("Failed to send onboarding invite", err, { endpoint: `/workspaces/${workspaceId}/invites` });
      setInviteError("Unable to send invite.");
    } finally {
      setInviting(false);
    }
  }

  function handleUploadSuccess(file: MessageAttachment) {
    const label = file.file_name || file.filename || "Uploaded source";
    setUploadedSources((current) => [label, ...current.filter((item) => item !== label)]);
  }

  function finishOnboarding() {
    if (!onboardingWorkspace?.id) {
      setStep("workspace");
      return;
    }
    setActiveWorkspace(onboardingWorkspace.id);
    setOnboardingComplete(true);
  }

  const StepIcon = steps[currentStepIndex]?.icon ?? UserCircle;

  return (
    <main
      ref={onboardingTrapRef}
      className="omnix-app-bg flex min-h-[100dvh] items-start justify-center overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-white sm:py-8"
    >
      <div className="relative z-10 w-full max-w-5xl">
        <div className="mb-6 flex flex-col gap-4 text-center sm:mb-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-[var(--omnix-cyan)] shadow-[0_0_24px_rgba(0,255,255,0.15)]">
            <Layers3 className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Set up Omnix</h1>
            <p className="mt-2 text-sm text-[var(--omnix-text-2)]">
              Complete the five onboarding steps before entering your workspace.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside className="rounded-2xl border border-[var(--omnix-border)] bg-[rgba(8,16,30,0.82)] p-4 shadow-[var(--omnix-glow-sm)] backdrop-blur-xl">
            <div className="space-y-2">
              {steps.map((item, index) => {
                const Icon = item.icon;
                const active = item.id === step;
                const complete = index < currentStepIndex || (item.id === "workspace" && hasWorkspaceForFlow);
                const locked = index > 1 && !hasWorkspaceForFlow;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={locked}
                    onClick={() => goTo(item.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                      active
                        ? "border-cyan-300/35 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                        : "border-transparent bg-white/[0.025] text-[var(--omnix-text-2)] hover:border-white/10 hover:bg-white/[0.045]",
                      locked && "cursor-not-allowed opacity-45 hover:border-transparent hover:bg-white/[0.025]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                        active || complete
                          ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
                          : "border-white/10 bg-white/[0.03] text-[var(--omnix-text-3)]",
                      )}
                    >
                      {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--omnix-text-3)]">{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-xl border border-white/5 bg-white/[0.025] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">Account</div>
              <div className="mt-2 truncate text-sm font-medium text-white">{userLabel(user?.email)}</div>
            </div>

            <Button
              type="button"
              variant="ghost"
              className="mt-4 w-full justify-center text-xs text-[var(--omnix-text-3)] hover:text-white"
              onClick={() => signOut()}
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign out
            </Button>
          </aside>

          <section className="min-h-[560px] rounded-2xl border border-[var(--omnix-border)] bg-[rgba(8,16,30,0.9)] p-4 shadow-[var(--omnix-glow-sm)] backdrop-blur-xl sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/5 pb-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                  <StepIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
                    Step {currentStepIndex + 1} of {steps.length}
                  </div>
                  <h2 className="mt-1 text-xl font-semibold text-white">{steps[currentStepIndex]?.label}</h2>
                </div>
              </div>
              {onboardingWorkspace ? (
                <div className="hidden rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-right sm:block">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/60">Workspace</div>
                  <div className="max-w-[220px] truncate text-sm font-medium text-cyan-50">{onboardingWorkspace.name}</div>
                </div>
              ) : null}
            </div>

            {step === "account" ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">Your account is active</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Omnix is using your authenticated session to keep the workspace hierarchy, files, and invites tied to the right user.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">Signed in as</div>
                    <div className="mt-2 truncate text-sm font-medium text-white">{userLabel(user?.email)}</div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">Session</div>
                    <div className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-emerald-200">
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      Ready
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="button" className="omnix-primary-action" onClick={() => goTo("workspace")} rightIcon={<ArrowRight className="h-4 w-4" />}>
                    Continue
                  </Button>
                </div>
              </div>
            ) : null}

            {step === "workspace" ? (
              <div className="space-y-6">
                {error ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <div className="flex gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 text-rose-300" />
                      <div>
                        <p className="text-sm font-medium text-rose-100">Unable to load workspaces</p>
                        <p className="mt-1 text-sm text-rose-100/75">{error}</p>
                        <Button
                          type="button"
                          variant="secondary"
                          className="mt-3 border-rose-500/30 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
                          onClick={() => refreshWorkspaces({ force: true })}
                        >
                          Retry
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {!error && pendingInvites.length > 0 ? (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Join an existing workspace</h3>
                      <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Accepting an invite uses the real workspace invite flow.</p>
                    </div>
                    <div className="grid gap-3">
                      {pendingInvites.map((invite) => {
                        const inviteId = invite.invite_id || invite.id;
                        return (
                          <div key={inviteId} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-white">{inviteLabel(invite)}</p>
                                <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Invited by {invite.inviter_name || invite.inviter_email || invite.invited_by || "a workspace member"}</p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="omnix-primary-action"
                                  onClick={() => handleAccept(inviteId)}
                                  isLoading={acceptingId === inviteId}
                                  disabled={acceptingId !== null || decliningId !== null}
                                  leftIcon={<Check className="h-4 w-4" />}
                                >
                                  Accept
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="hover:bg-rose-500/20 hover:text-rose-200"
                                  onClick={() => handleDecline(inviteId)}
                                  isLoading={decliningId === inviteId}
                                  disabled={acceptingId !== null || decliningId !== null}
                                  leftIcon={<X className="h-4 w-4" />}
                                >
                                  Decline
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {!error ? (
                  <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Create a workspace</h3>
                      <p className="mt-1 text-xs text-[var(--omnix-text-3)]">This creates the root workspace that unlocks the app.</p>
                    </div>
                    <Input
                      id="onboarding-workspace-name"
                      label="Workspace name"
                      value={workspaceName}
                      onChange={(event) => {
                        setWorkspaceName(event.target.value);
                        setCreateError(null);
                      }}
                      disabled={creating}
                      autoFocus
                      placeholder="Acme Operations"
                      error={createError === "Workspace name is required." ? createError : undefined}
                    />
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-200">Description</span>
                      <textarea
                        value={workspaceDescription}
                        onChange={(event) => setWorkspaceDescription(event.target.value)}
                        disabled={creating}
                        rows={3}
                        className="omnix-input w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="What will this workspace help your team do?"
                      />
                    </label>
                    <div className="space-y-2">
                      <span className="text-sm font-medium text-slate-200">Workspace focus</span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {focusOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setWorkspaceFocus(option.value)}
                            className={cn(
                              "rounded-xl border px-3 py-3 text-left transition",
                              workspaceFocus === option.value
                                ? "border-cyan-300/35 bg-cyan-300/10 text-white"
                                : "border-white/10 bg-white/[0.025] text-[var(--omnix-text-2)] hover:border-white/20",
                            )}
                          >
                            <span className="block text-sm font-semibold">{option.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-[var(--omnix-text-3)]">{option.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {createError && createError !== "Workspace name is required." ? (
                      <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                        {createError}
                      </div>
                    ) : null}
                    <Button
                      type="submit"
                      className="w-full omnix-primary-action"
                      isLoading={creating}
                      disabled={!workspaceName.trim()}
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      Create workspace
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}

            {step === "team" ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">Invite your first teammate</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    This is optional. If you invite someone here, Omnix sends a real workspace invite through the existing backend.
                  </p>
                </div>
                <form onSubmit={handleInvite} className="space-y-3 rounded-xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
                  <Input
                    id="onboarding-invite-email"
                    label="Teammate email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => {
                      setInviteEmail(event.target.value);
                      setInviteError(null);
                    }}
                    disabled={inviting}
                    icon={<Mail className="h-4 w-4" />}
                    placeholder="teammate@company.com"
                    error={inviteError === "Enter an email address to invite." ? inviteError : undefined}
                  />
                  {inviteError && inviteError !== "Enter an email address to invite." ? (
                    <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                      {inviteError}
                    </div>
                  ) : null}
                  <Button
                    type="submit"
                    variant="secondary"
                    className="w-full"
                    isLoading={inviting}
                    disabled={!inviteEmail.trim()}
                    leftIcon={<Users className="h-4 w-4" />}
                  >
                    Send invite
                  </Button>
                </form>
                {sentInvites.length > 0 ? (
                  <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/5 p-4">
                    <div className="text-sm font-semibold text-emerald-100">Invites sent</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {sentInvites.map((email) => (
                        <span key={email} className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                          {email}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <StepNavigation
                  onBack={() => goTo("workspace")}
                  onNext={() => goTo("knowledge")}
                  nextLabel={sentInvites.length > 0 ? "Continue" : "Skip for now"}
                />
              </div>
            ) : null}

            {step === "knowledge" ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-white">Add workspace knowledge</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Uploading here uses the same source ingestion path as the app. You can skip this and add sources later.
                  </p>
                </div>
                {onboardingWorkspace ? (
                  <UploadDropzone
                    key={onboardingWorkspace.id}
                    onUploadSuccess={handleUploadSuccess}
                  />
                ) : (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                    Create or join a workspace before uploading sources.
                  </div>
                )}
                {uploadedSources.length > 0 ? (
                  <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/5 p-4">
                    <div className="text-sm font-semibold text-emerald-100">Sources uploaded</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {uploadedSources.map((source) => (
                        <span key={source} className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                          {source}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <StepNavigation
                  onBack={() => goTo("team")}
                  onNext={() => goTo("done")}
                  nextLabel={uploadedSources.length > 0 ? "Continue" : "Skip for now"}
                />
              </div>
            ) : null}

            {step === "done" ? (
              <div className="space-y-6">
                <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-6 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-white">Onboarding complete</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Your workspace is ready. Optional team and knowledge steps are recorded only when real actions succeeded.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <SummaryCard label="Workspace" value={onboardingWorkspace?.name ?? "Ready"} />
                  <SummaryCard label="Invites sent" value={String(sentInvites.length)} />
                  <SummaryCard label="Sources uploaded" value={String(uploadedSources.length)} />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                  <Button type="button" variant="ghost" onClick={() => goTo("knowledge")} leftIcon={<ArrowLeft className="h-4 w-4" />}>
                    Back
                  </Button>
                  <Button type="button" className="omnix-primary-action" onClick={finishOnboarding} rightIcon={<ArrowRight className="h-4 w-4" />}>
                    Enter workspace
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function StepNavigation({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      <Button type="button" variant="ghost" onClick={onBack} leftIcon={<ArrowLeft className="h-4 w-4" />}>
        Back
      </Button>
      <Button type="button" className="omnix-primary-action" onClick={onNext} rightIcon={<ArrowRight className="h-4 w-4" />}>
        {nextLabel}
      </Button>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{label}</div>
      <div className="mt-2 truncate text-sm font-medium text-white">{value}</div>
    </div>
  );
}
