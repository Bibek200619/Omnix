"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, BadgeCheck, ClipboardCheck, Loader2, MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceMentionInboxItem, WorkspaceMentionSourceType } from "@/lib/workspace-types";

const sourceConfig: Record<WorkspaceMentionSourceType, { label: string; icon: typeof MessagesSquare; tone: string }> = {
  conversation_message: { label: "Conversations", icon: MessagesSquare, tone: "text-cyan-100" },
  task: { label: "Tasks", icon: ClipboardCheck, tone: "text-emerald-100" },
  decision: { label: "Decisions", icon: BadgeCheck, tone: "text-violet-100" },
};

function readableTime(value?: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function actorLabel(item: WorkspaceMentionInboxItem) {
  return item.mentioned_by_name || item.mentioned_by_email || "Workspace member";
}

export function MentionsInboxSurface() {
  const router = useRouter();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const [mentions, setMentions] = useState<WorkspaceMentionInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadMentions = useCallback(async () => {
    if (!activeWorkspaceId) {
      setMentions([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const incoming = await apiClient.listWorkspaceMentions(activeWorkspaceId);
      if (requestId !== requestRef.current) return;
      setMentions(incoming);
      setError(null);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      logClientError("Failed to load mentions", err, { endpoint: `/workspaces/${activeWorkspaceId}/mentions` });
      setError("Unable to load mentions.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    setMentions([]);
    void loadMentions();
  }, [loadMentions]);

  const grouped = useMemo(() => {
    return mentions.reduce<Record<WorkspaceMentionSourceType, WorkspaceMentionInboxItem[]>>(
      (acc, item) => {
        acc[item.source_type].push(item);
        return acc;
      },
      { conversation_message: [], task: [], decision: [] },
    );
  }, [mentions]);

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to review mentions.</p>
      </section>
    );
  }

  return (
    <section className="omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <AtSign className="h-3.5 w-3.5" />
            Awareness layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Mentions</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">
            {activeWorkspace?.name} references that explicitly include you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMentions()}
          className="min-h-10 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.05] px-3 text-xs font-medium text-cyan-100/80 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.09]"
        >
          Refresh
        </button>
      </header>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title="Mentions are unavailable"
          message={error}
          onRetry={() => void loadMentions()}
          isRetrying={loading}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <main className="omnix-panel min-h-[24rem] rounded-xl p-3 sm:p-4">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-100/45" />
          </div>
        ) : null}

        {!loading && mentions.length === 0 ? (
          <div className="mx-auto flex min-h-[18rem] max-w-sm flex-col items-center justify-center text-center">
            <AtSign className="h-8 w-8 text-cyan-100/35" />
            <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No workspace mentions yet.</p>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">
              Mentions appear here after a workspace member explicitly includes you.
            </p>
          </div>
        ) : null}

        {!loading && mentions.length > 0 ? (
          <div className="space-y-5">
            {(Object.keys(sourceConfig) as WorkspaceMentionSourceType[]).map((sourceType) => {
              const items = grouped[sourceType];
              if (!items.length) return null;
              const config = sourceConfig[sourceType];
              const Icon = config.icon;
              return (
                <section key={sourceType}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <Icon className={cn("h-4 w-4", config.tone)} />
                    <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">
                      {config.label}
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => router.push(item.source_url)}
                        className="flex min-h-[76px] w-full items-start gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/[0.12] px-3 py-3 text-left transition hover:border-cyan-300/22 hover:bg-cyan-300/[0.045]"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/[0.07] text-xs font-semibold text-cyan-100">
                          {item.mentioned_by_avatar_label || "U"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-medium text-white">{actorLabel(item)}</span>
                            <span className="text-[11px] text-[var(--omnix-text-3)]">{readableTime(item.created_at)}</span>
                          </span>
                          <span className="mt-1 block truncate text-sm text-cyan-100/85">{item.source_title}</span>
                          {item.source_preview ? (
                            <span className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">
                              {item.source_preview}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </main>
    </section>
  );
}
