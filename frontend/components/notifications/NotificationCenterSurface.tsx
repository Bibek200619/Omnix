"use client";

import { useState } from "react";
import { AtSign, BadgeCheck, Check, ClipboardCheck, Loader2, MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { useWorkspace } from "@/lib/workspace-context";
import { useWorkspaceNotifications } from "@/lib/workspace-notifications-context";
import { cn } from "@/lib/utils";
import type { WorkspaceMentionInboxItem, WorkspaceMentionSourceType } from "@/lib/workspace-types";

const sourceConfig: Record<
  WorkspaceMentionSourceType,
  { label: string; phrasePrefix: string; icon: typeof MessagesSquare; tone: string }
> = {
  conversation_message: { label: "Conversation", phrasePrefix: "", icon: MessagesSquare, tone: "text-cyan-100" },
  task: { label: "Task", phrasePrefix: "Task: ", icon: ClipboardCheck, tone: "text-emerald-100" },
  decision: { label: "Decision", phrasePrefix: "Decision: ", icon: BadgeCheck, tone: "text-violet-100" },
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

function avatarLabel(item: WorkspaceMentionInboxItem) {
  return (item.mentioned_by_avatar_label || actorLabel(item).trim().charAt(0) || "U").toUpperCase();
}

function mentionSentence(item: WorkspaceMentionInboxItem) {
  const config = sourceConfig[item.source_type];
  return `${actorLabel(item)} mentioned you in ${config.phrasePrefix}${item.source_title}`;
}

export function NotificationCenterSurface() {
  const router = useRouter();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const {
    mentions,
    unreadCount,
    loading,
    error,
    refreshNotifications,
    markMentionRead,
    markAllMentionsRead,
  } = useWorkspaceNotifications();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  async function openNotification(item: WorkspaceMentionInboxItem) {
    if (!item.read_at) {
      try {
        setBusyId(item.id);
        await markMentionRead(item.id);
      } catch {
        setBusyId(null);
        return;
      }
      setBusyId(null);
    }

    router.push(item.source_url);
  }

  async function handleMarkRead(item: WorkspaceMentionInboxItem) {
    try {
      setBusyId(item.id);
      await markMentionRead(item.id);
    } catch {
      return;
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkAllRead() {
    try {
      setMarkingAll(true);
      await markAllMentionsRead();
    } catch {
      return;
    } finally {
      setMarkingAll(false);
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to review notifications.</p>
      </section>
    );
  }

  return (
    <section className="omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-5">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--omnix-border)] px-1 pb-4 sm:px-0">
        <div className="min-w-0">
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <AtSign className="h-3.5 w-3.5" />
            Mention notifications
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-[var(--omnix-text-2)]">
            {unreadCount > 0
              ? `${unreadCount} unread mention${unreadCount === 1 ? "" : "s"} in ${activeWorkspace?.name || "this workspace"}.`
              : "No unread mentions right now."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 min-[390px]:w-auto min-[390px]:justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void refreshNotifications()}
            isLoading={loading}
            className="min-h-10 flex-1 min-[390px]:flex-none"
          >
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleMarkAllRead()}
            isLoading={markingAll}
            disabled={unreadCount === 0}
            leftIcon={<Check className="h-3.5 w-3.5" />}
            className="min-h-10 flex-1 min-[390px]:flex-none"
          >
            Mark all read
          </Button>
        </div>
      </header>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title="Notifications are unavailable"
          message={error}
          onRetry={() => void refreshNotifications()}
          isRetrying={loading}
        />
      ) : null}

      {loading && mentions.length === 0 ? (
        <div className="flex min-h-[18rem] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-100/45" />
        </div>
      ) : null}

      {!loading && mentions.length === 0 ? (
        <div className="mx-auto flex min-h-[22rem] max-w-sm flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/12 bg-cyan-300/[0.045] text-cyan-100/45">
            <AtSign className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-medium text-white">You&apos;re all caught up.</p>
          <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">No unread mentions right now.</p>
        </div>
      ) : null}

      {mentions.length > 0 ? (
        <div className="space-y-2">
          {mentions.map((item) => {
            const config = sourceConfig[item.source_type];
            const Icon = config.icon;
            const unread = !item.read_at;
            const busy = busyId === item.id;

            return (
              <article
                key={item.id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border px-3 py-3 transition sm:flex-row sm:items-start sm:px-4",
                  unread
                    ? "border-cyan-300/18 bg-cyan-300/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
                    : "border-[var(--omnix-border)] bg-black/[0.12]",
                )}
              >
                <button
                  type="button"
                  onClick={() => void openNotification(item)}
                  className="flex min-h-[4.25rem] min-w-0 flex-1 items-start gap-3 rounded-lg text-left transition hover:bg-white/[0.025] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/[0.07] text-xs font-semibold text-cyan-100">
                    {avatarLabel(item).slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1 py-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
                        <Icon className={cn("h-3.5 w-3.5", config.tone)} />
                        {config.label}
                      </span>
                      <span className="text-[11px] text-[var(--omnix-text-3)]">{readableTime(item.created_at)}</span>
                    </span>
                    <span className="mt-1 block text-sm font-medium leading-5 text-white">{mentionSentence(item)}</span>
                    {item.source_preview ? (
                      <span className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">
                        {item.source_preview}
                      </span>
                    ) : null}
                  </span>
                </button>

                <div className="flex shrink-0 items-center justify-between gap-2 pl-[3.25rem] sm:w-32 sm:flex-col sm:items-end sm:justify-start sm:pl-0">
                  <span
                    className={cn(
                      "inline-flex min-h-7 items-center rounded-full border px-2 text-[11px] font-medium",
                      unread
                        ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.035] text-white/45",
                    )}
                  >
                    {unread ? "Unread" : "Read"}
                  </span>
                  {unread ? (
                    <button
                      type="button"
                      onClick={() => void handleMarkRead(item)}
                      disabled={busy}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-xs font-medium text-cyan-100/85 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.09] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Mark read
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
