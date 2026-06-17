"use client";

import { CircleDot, MessagesSquare, X } from "lucide-react";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { cn } from "@/lib/utils";

type WorkspaceConversationChromeProps = {
  activeCount: number;
  channelsLoading: boolean;
  decisionConfirmation: string | null;
  error: string | null;
  onDismissDecision: () => void;
  onDismissError: () => void;
  onDismissTask: () => void;
  onRetryConversations?: () => void;
  realtimeStatus: string;
  taskConfirmation: string | null;
  workspaceName?: string | null;
};

export function WorkspaceConversationChrome({
  activeCount,
  channelsLoading,
  decisionConfirmation,
  error,
  onDismissDecision,
  onDismissError,
  onDismissTask,
  onRetryConversations,
  realtimeStatus,
  taskConfirmation,
  workspaceName,
}: WorkspaceConversationChromeProps) {
  return (
    <>
      <header className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <MessagesSquare className="h-3.5 w-3.5" />
            Execution layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Workspace Conversations</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">
            {workspaceName} operational discussion, decisions, and coordination.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {activeCount} active <span className="text-[var(--omnix-text-3)]">/</span> {realtimeStatus === "connected" ? "connected" : "recovering"}
        </div>
      </header>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-3"
          title={error === "Unable to load conversations." ? "Conversations are unavailable" : "Conversation action needs attention"}
          message={error}
          onRetry={error === "Unable to load conversations." ? onRetryConversations : undefined}
          isRetrying={channelsLoading}
          onDismiss={onDismissError}
        />
      ) : null}
      {taskConfirmation ? (
        <Confirmation message={`${taskConfirmation}. Source context is preserved.`} onDismiss={onDismissTask} tone="task" />
      ) : null}
      {decisionConfirmation ? (
        <Confirmation message={`${decisionConfirmation}. Source message and channel are preserved.`} onDismiss={onDismissDecision} tone="decision" />
      ) : null}
    </>
  );
}

function Confirmation({ message, onDismiss, tone }: { message: string; onDismiss: () => void; tone: "task" | "decision" }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs", tone === "task" ? "border-emerald-300/18 bg-emerald-300/[0.06] text-emerald-100" : "border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-100")}>
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss confirmation">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
