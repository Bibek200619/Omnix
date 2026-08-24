"use client";

import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Activity, ArrowUpRight, AtSign, BadgeCheck, Check, ClipboardCheck, Loader2, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { activityDestination, activityLabel, buildNotificationFeed, type NotificationFeedFilter } from "@/components/notifications/notificationFeedModel";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceTree } from "@/lib/workspace-context";
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

export const NotificationCenterSurface = memo(function NotificationCenterSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Notifications">
      <NotificationCenterSurfaceContent />
    </SurfaceErrorBoundary>
  );
});

function NotificationCenterSurfaceContent() {
  const router = useRouter();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const {
    mentions,
    unreadCount,
    loading,
    error,
    refreshNotifications,
    markMentionRead,
    markAllMentionsRead,
  } = useWorkspaceNotifications();
  const { activity, loadingActivity, refreshActivity } = useWorkspaceCollaboration();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<NotificationFeedFilter>("all");
  const notificationListRef = useRef<HTMLDivElement | null>(null);
  const feed = useMemo(() => buildNotificationFeed(mentions, activity, filter), [activity, filter, mentions]);
  const isLoading = loading || loadingActivity;

  const notificationVirtualizer = useVirtualizer({
    count: feed.length,
    getScrollElement: () => notificationListRef.current,
    estimateSize: () => 88,
    overscan: 6,
  });

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
    <section aria-busy={isLoading} className="omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-5">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--omnix-border)] px-1 pb-4 sm:px-0">
        <div className="min-w-0">
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <AtSign className="h-3.5 w-3.5" />
            Workspace inbox
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Notifications</h1>
          <p role="status" aria-live="polite" aria-atomic="true" className="mt-1 text-sm text-[var(--omnix-text-2)]">
            {isLoading && feed.length === 0
              ? "Loading workspace events…"
              : unreadCount > 0
              ? `${unreadCount} unread mention${unreadCount === 1 ? "" : "s"} in ${activeWorkspace?.name || "this workspace"}.`
              : activity.length > 0
              ? `${activity.length} workspace event${activity.length === 1 ? "" : "s"}; no unread mentions.`
              : "No unread mentions right now."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 min-[390px]:w-auto min-[390px]:justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void Promise.all([refreshNotifications(), refreshActivity()])}
            isLoading={isLoading}
            className="min-h-11 flex-1 min-[390px]:flex-none"
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
            className="min-h-11 flex-1 min-[390px]:flex-none"
          >
            Mark all read
          </Button>
        </div>
      </header>

      <div className="mb-4 flex gap-2 overflow-x-auto" role="group" aria-label="Notification filters">
        {(["all", "mentions", "activity"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={cn(
              "min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium capitalize transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
              filter === option
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                : "border-[var(--omnix-border)] bg-black/15 text-[var(--omnix-text-2)] hover:text-white",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title="Notifications are unavailable"
          message={error}
          onRetry={() => void refreshNotifications()}
          isRetrying={isLoading}
        />
      ) : null}

      {isLoading && feed.length === 0 ? (
        <div className="min-h-[18rem]">
          <div className="grid gap-2" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/[0.12] px-3 py-3 sm:flex-row sm:items-start sm:px-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton variant="line" className="h-3 w-24" />
                  <Skeleton variant="line" className="h-3 w-16" />
                </div>
                <Skeleton variant="line" className="mt-2 h-4 w-full max-w-lg" />
                <Skeleton className="mt-2 h-7 w-40 rounded-full" />
                <Skeleton variant="line" className="mt-2 h-3 w-full max-w-md" />
              </div>
              <div className="flex shrink-0 gap-2 pl-[3.25rem] sm:w-32 sm:flex-col sm:items-end sm:pl-0">
                <Skeleton className="h-7 w-16 rounded-full" />
                <Skeleton className="h-9 w-24 rounded-lg sm:w-full" />
              </div>
            </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoading && feed.length === 0 ? (
        <EmptyState
          icon={filter === "activity" ? Activity : AtSign}
          title={filter === "all" ? "You're all caught up" : `No ${filter} yet`}
          description={filter === "mentions" ? "Direct mentions will appear here." : filter === "activity" ? "Workspace changes will appear here." : "Mentions and workspace changes will appear here."}
          className="mx-auto min-h-[22rem] max-w-lg"
        />
      ) : null}

      {feed.length > 0 ? (
        <div ref={notificationListRef} className="omnix-scrollbar min-h-[18rem] flex-1 overflow-y-auto">
          <div className="relative w-full" style={{ height: notificationVirtualizer.getTotalSize() }}>
            {notificationVirtualizer.getVirtualItems().map((virtualRow) => {
              const feedItem = feed[virtualRow.index];
              if (!feedItem) return null;

              if (feedItem.kind === "activity") {
                const item = feedItem.activity;
                return (
                  <div key={feedItem.id} data-index={virtualRow.index} ref={notificationVirtualizer.measureElement} className="absolute left-0 top-0 w-full pb-2" style={{ transform: `translateY(${virtualRow.start}px)` }}>
                    <article className="flex min-h-[5.5rem] items-start gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/[0.12] px-3 py-3 sm:px-4">
                      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-violet-300/[0.07] text-violet-100"><Activity className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--omnix-text-3)]">
                          <span className="font-semibold uppercase tracking-[0.12em]">{activityLabel(item.event_type)}</span>
                          <span>{readableTime(item.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm font-medium leading-5 text-white">{item.summary}</p>
                        <p className="mt-1 text-xs text-[var(--omnix-text-2)]">{item.actor_name || item.actor_email || "Omnix workspace"}</p>
                      </div>
                      <Link href={activityDestination(item.event_type)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-violet-300/15 px-3 text-xs font-medium text-violet-100 transition hover:bg-violet-300/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60">
                        Open <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </article>
                  </div>
                );
              }

              const item = feedItem.mention;
              if (!item) return null;

              const config = sourceConfig[item.source_type];
              const Icon = config.icon;
              const unread = !item.read_at;
              const busy = busyId === item.id;

              return (
                <div
                  key={feedItem.id}
                  data-index={virtualRow.index}
                  ref={notificationVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-2"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <article
                    className={cn(
                      "relative flex flex-col gap-3 overflow-hidden rounded-xl border px-3 py-3 transition active:scale-[0.995] sm:flex-row sm:items-start sm:px-4",
                      unread
                        ? "border-cyan-300/18 bg-cyan-300/[0.045] shadow-[inset_0_1px_0_var(--omnix-rgba-255-255-255-0-035)]"
                        : "border-[var(--omnix-border)] bg-black/[0.12]",
                    )}
                  >
                    {unread ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-cyan-300/80 shadow-[var(--omnix-glow-xs)]" /> : null}
                    <button
                      type="button"
                      onClick={() => void openNotification(item)}
                      className="flex min-h-[4.75rem] min-w-0 flex-1 items-start gap-3 rounded-lg text-left transition hover:bg-white/[0.025] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
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
                        <span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.025] px-2 py-1 text-[11px] text-[var(--omnix-text-3)]">
                          <ArrowUpRight className="h-3 w-3 shrink-0 text-cyan-100/45" />
                          <span className="truncate">{item.source_title}</span>
                        </span>
                        {item.source_preview ? (
                          <span className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">
                            {item.source_preview}
                          </span>
                        ) : null}
                      </span>
                    </button>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pl-[3.25rem] sm:w-32 sm:flex-col sm:items-end sm:justify-start sm:pl-0">
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
                      <button
                        type="button"
                        onClick={() => void openNotification(item)}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.04] px-3 text-xs font-medium text-cyan-100/80 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.08] sm:w-full"
                      >
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                      {unread ? (
                        <button
                          type="button"
                          onClick={() => void handleMarkRead(item)}
                          disabled={busy}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-xs font-medium text-cyan-100/85 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.09] disabled:cursor-not-allowed disabled:opacity-60 sm:w-full"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
