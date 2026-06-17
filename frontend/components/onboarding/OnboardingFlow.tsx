"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, FileText, Loader2, MessageSquare, Send, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import type { MessageAttachment } from "@/components/chat/types";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

export const ONBOARDING_COMPLETED_KEY = "omnix.onboarding.completed";

type StepId = "welcome" | "invite" | "upload" | "chat";

type ChatResponse = {
  conversation_id: string;
};

const steps: Array<{ id: StepId; label: string; icon: typeof Users }> = [
  { id: "welcome", label: "Welcome", icon: Users },
  { id: "invite", label: "Invite", icon: UserPlus },
  { id: "upload", label: "Upload", icon: FileText },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

function stepIndex(step: StepId) {
  return steps.findIndex((item) => item.id === step);
}

export function OnboardingFlow() {
  const router = useRouter();
  const {
    activeWorkspace,
    createWorkspace,
    inviteToActiveWorkspace,
    refreshWorkspaces,
    setActiveWorkspace,
  } = useWorkspace();

  const [currentStep, setCurrentStep] = useState<StepId>("welcome");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [sentInvites, setSentInvites] = useState<string[]>([]);

  const [uploadedSources, setUploadedSources] = useState<string[]>([]);

  const [chatPrompt, setChatPrompt] = useState("Summarize how Omnix can help this workspace get started.");
  const [chatError, setChatError] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);

  const activeIndex = stepIndex(currentStep);
  const ActiveIcon = steps[activeIndex]?.icon ?? Users;
  const workspaceLabel = activeWorkspace?.name || "No workspace selected";

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true") {
        router.replace("/dashboard");
      }
    } catch {
      // If storage is unavailable, keep the flow visible.
    }
  }, [router]);

  const canUseWorkspaceActions = Boolean(activeWorkspace?.id);
  const completedSummary = useMemo(
    () => [
      activeWorkspace?.name ? `Workspace: ${activeWorkspace.name}` : null,
      sentInvites.length ? `${sentInvites.length} invite${sentInvites.length === 1 ? "" : "s"} sent` : null,
      uploadedSources.length ? `${uploadedSources.length} source${uploadedSources.length === 1 ? "" : "s"} uploaded` : null,
      chatConversationId ? "First AI message sent" : null,
    ].filter(Boolean),
    [activeWorkspace?.name, chatConversationId, sentInvites.length, uploadedSources.length],
  );

  function goToStep(step: StepId) {
    setCurrentStep(step);
  }

  function nextStep() {
    const next = steps[activeIndex + 1]?.id;
    if (next) {
      setCurrentStep(next);
      return;
    }
    completeOnboarding();
  }

  function completeOnboarding() {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    router.replace("/dashboard");
  }

  async function handleWorkspaceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeWorkspace?.id && !workspaceName.trim()) {
      nextStep();
      return;
    }

    const name = workspaceName.trim();
    if (!name) {
      setWorkspaceError("Enter a workspace name or skip this step.");
      return;
    }

    try {
      setCreatingWorkspace(true);
      setWorkspaceError(null);
      const workspace = await createWorkspace({ name, workspace_type: "super_workspace" });
      setActiveWorkspace(workspace.id);
      await refreshWorkspaces({ force: true, silent: true });
      nextStep();
    } catch (err) {
      logClientError("Failed to create onboarding workspace", err, { endpoint: "/workspaces" });
      setWorkspaceError("Unable to create workspace.");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      setInviteError("Enter an email address or skip this step.");
      return;
    }
    if (!canUseWorkspaceActions) {
      setInviteError("Create or select a workspace before inviting teammates.");
      return;
    }

    try {
      setInviting(true);
      setInviteError(null);
      await inviteToActiveWorkspace(email, "member");
      setSentInvites((current) => [email, ...current.filter((item) => item !== email)]);
      setInviteEmail("");
    } catch (err) {
      logClientError("Failed to send onboarding invite", err);
      setInviteError("Unable to send invite.");
    } finally {
      setInviting(false);
    }
  }

  function handleUploadSuccess(file: MessageAttachment) {
    const label = file.file_name || file.filename || "Uploaded source";
    setUploadedSources((current) => [label, ...current.filter((item) => item !== label)]);
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatPrompt.trim();
    if (!message) {
      setChatError("Enter a message or skip this step.");
      return;
    }

    try {
      setSendingChat(true);
      setChatError(null);
      const response = await apiClient.post<ChatResponse>("/chat", {
        message,
        search_mode: "auto",
      });
      setChatConversationId(response.conversation_id);
      completeOnboarding();
    } catch (err) {
      logClientError("Failed to send onboarding chat message", err, { endpoint: "/chat" });
      setChatError("Unable to send this message.");
    } finally {
      setSendingChat(false);
    }
  }

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex min-h-full flex-col gap-5 py-5 sm:py-8">
        <div className="omnix-page-hero">
          <div>
            <h1 className="omnix-page-title omnix-gradient-text">Welcome</h1>
            <p className="omnix-page-subtitle">Set up the essentials for {workspaceLabel}.</p>
          </div>
          <Button type="button" variant="ghost" onClick={completeOnboarding}>
            Skip
          </Button>
        </div>

        <div className="grid min-h-0 gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="omnix-cinematic-card p-4">
            <div className="space-y-2">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const active = step.id === currentStep;
                const complete = index < activeIndex;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => goToStep(step.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[var(--omnix-radius-sm)] border px-3 py-3 text-left transition",
                      active
                        ? "border-cyan-300/30 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                        : "border-white/5 bg-white/[0.025] text-[var(--omnix-text-2)] hover:border-white/10 hover:bg-white/[0.045]",
                    )}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                      {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{step.label}</span>
                      <span className="block text-[11px] text-[var(--omnix-text-3)]">Step {index + 1} of 4</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {completedSummary.length ? (
              <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.025] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">Recorded</div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--omnix-text-2)]">
                  {completedSummary.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                      <span className="min-w-0 truncate">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>

          <div className="omnix-cinematic-card min-h-[520px] p-5 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-white/5 pb-5">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                  <ActiveIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
                    Step {activeIndex + 1} of 4
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-white">{steps[activeIndex]?.label}</h2>
                </div>
              </div>
              <Button type="button" variant="ghost" onClick={activeIndex === steps.length - 1 ? completeOnboarding : nextStep}>
                Skip
              </Button>
            </div>

            {currentStep === "welcome" ? (
              <form onSubmit={handleWorkspaceSubmit} className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-white">Name your first workspace</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    This creates a real workspace record and makes it the active context for chat, uploads, tasks, and decisions.
                  </p>
                </div>
                <Input
                  id="first-workspace-name"
                  label="Workspace name"
                  value={workspaceName}
                  onChange={(event) => {
                    setWorkspaceName(event.target.value);
                    setWorkspaceError(null);
                  }}
                  placeholder={activeWorkspace?.name || "Acme Operations"}
                  disabled={creatingWorkspace}
                />
                {workspaceError ? <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{workspaceError}</div> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" onClick={completeOnboarding}>
                    Skip
                  </Button>
                  <Button type="submit" className="omnix-primary-action" isLoading={creatingWorkspace} rightIcon={<ArrowRight className="h-4 w-4" />}>
                    Continue
                  </Button>
                </div>
              </form>
            ) : null}

            {currentStep === "invite" ? (
              <form onSubmit={handleInviteSubmit} className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-white">Invite teammates</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Invitations use the workspace member flow and can be skipped.
                  </p>
                </div>
                <Input
                  id="onboarding-invite-email"
                  label="Email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setInviteError(null);
                  }}
                  placeholder="teammate@example.com"
                  disabled={inviting || !canUseWorkspaceActions}
                />
                {inviteError ? <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{inviteError}</div> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button type="submit" variant="secondary" isLoading={inviting} disabled={!canUseWorkspaceActions} leftIcon={<UserPlus className="h-4 w-4" />}>
                    Send invite
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={nextStep}>
                      Skip
                    </Button>
                    <Button type="button" className="omnix-primary-action" onClick={nextStep} rightIcon={<ArrowRight className="h-4 w-4" />}>
                      Continue
                    </Button>
                  </div>
                </div>
              </form>
            ) : null}

            {currentStep === "upload" ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-white">Add your first document</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Uploading uses the same document pipeline as the rest of the workspace.
                  </p>
                </div>
                <UploadDropzone compact onUploadSuccess={handleUploadSuccess} />
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" onClick={nextStep}>
                    Skip
                  </Button>
                  <Button type="button" className="omnix-primary-action" onClick={nextStep} rightIcon={<ArrowRight className="h-4 w-4" />}>
                    Continue
                  </Button>
                </div>
              </div>
            ) : null}

            {currentStep === "chat" ? (
              <form onSubmit={handleChatSubmit} className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-white">Send your first AI message</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
                    This sends a real chat request and creates a conversation in the active workspace.
                  </p>
                </div>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">Message</span>
                  <textarea
                    value={chatPrompt}
                    onChange={(event) => {
                      setChatPrompt(event.target.value);
                      setChatError(null);
                    }}
                    rows={5}
                    disabled={sendingChat}
                    className="omnix-input w-full resize-none rounded-lg bg-black/20 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                {chatError ? <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{chatError}</div> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" onClick={completeOnboarding}>
                    Skip
                  </Button>
                  <Button type="submit" className="omnix-primary-action" isLoading={sendingChat} leftIcon={sendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>
                    Send and finish
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
