"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, LayoutDashboard, MessageSquare, RefreshCw, Sparkles, Users, Zap, Construction } from "lucide-react";
import { PageTitle } from "@/components/ui/Typography";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";

type FileData = {
  id: string;
};

type Metric = {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  color: string;
};

function StudioCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.1)] bg-[linear-gradient(145deg,rgba(0,255,255,0.055),rgba(155,92,255,0.028)_52%,rgba(0,0,0,0.16))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-cyan-300/10 blur-[70px]" />
      <div className="relative z-10 mb-4 flex items-center justify-between">
        <div>
          <h2 className="omnix-display text-sm font-bold text-white">{title}</h2>
          <p className="mt-1 text-[11px] leading-5 text-[var(--omnix-text-3)]">{subtitle}</p>
        </div>
      </div>
      <div className="relative z-10">{children}</div>
    </section>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <article className="relative overflow-hidden rounded-xl border border-[var(--omnix-border)] bg-black/20 p-4 transition hover:-translate-y-0.5 hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)]">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2" style={{ background: `radial-gradient(ellipse at 100% 50%, ${metric.color}14 0%, transparent 70%)` }} />
      <div className="relative z-10 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border" style={{ background: `${metric.color}14`, borderColor: `${metric.color}33`, color: metric.color }}>
          {metric.icon}
        </span>
        <span className="min-w-0">
          <span className="omnix-display block text-2xl font-bold text-white">{metric.value}</span>
          <span className="block text-xs text-[var(--omnix-text-3)]">{metric.label}</span>
        </span>
      </div>
      <p className="relative z-10 mt-3 text-xs leading-5 text-[var(--omnix-text-3)]">{metric.detail}</p>
    </article>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnalyticsPageContent />
    </Suspense>
  );
}

function AnalyticsPageContent() {
  const { conversations, loading: conversationsLoading, refreshConversations } = useConversationHistory();
  const { activeWorkspace, activeMembers, activeInvites, workspaces } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const data = await apiClient.get<FileData[]>("/files");
      setFiles(data);
    } catch (err) {
      setFiles([]);
      logClientError("Failed to load source metrics", err, { endpoint: "/files" });
      setFilesError("Unable to load source metrics.");
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, activeWorkspace?.id]);

  const realMetrics = useMemo<Record<string, Metric>>(
    () => ({
      conversations: {
        label: "Conversations",
        value: conversationsLoading ? "..." : conversations.length,
        detail: conversations.length ? "Saved chat sessions for this workspace context." : "No saved conversations yet.",
        icon: <MessageSquare className="h-4 w-4" />,
        color: "#00FFFF",
      },
      members: {
        label: "Members",
        value: activeWorkspace?.member_count ?? activeMembers.length,
        detail: activeWorkspace ? `Membership loaded for ${activeWorkspace.name}.` : "No active workspace selected.",
        icon: <Users className="h-4 w-4" />,
        color: "#9b5cff",
      },
      sources: {
        label: "Sources",
        value: filesLoading ? "..." : files.length,
        detail: filesError ? "Source count could not be loaded." : files.length ? "Uploaded source records from the backend." : "No uploaded sources yet.",
        icon: <Database className="h-4 w-4" />,
        color: "#00e87a",
      },
      invites: {
        label: "Pending Invites",
        value: activeInvites.filter((invite) => invite.status === "pending").length,
        detail: "Pending workspace invite records.",
        icon: <Zap className="h-4 w-4" />,
        color: "#ffb800",
      },
      workspaces: {
        label: "Workspaces",
        value: workspaces.length,
        detail: "Root workspaces loaded from the hierarchy API.",
        icon: <LayoutDashboard className="h-4 w-4" />,
        color: "#ff4df4",
      },
    }),
    [activeInvites, activeMembers.length, activeWorkspace, conversations.length, conversationsLoading, files.length, filesError, filesLoading, workspaces.length],
  );

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-5">
        <div className="omnix-page-hero">
          <div>
            <PageTitle className="omnix-gradient-text">Analytics Studio</PageTitle>
            <p className="omnix-page-subtitle">
              Workspace telemetry and reporting. Custom boards are currently in development.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshConversations({ force: true });
              void loadFiles();
            }}
            className="inline-flex h-10 items-center gap-2 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-4 text-xs font-bold text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <div className="space-y-5">
          <section className="omnix-cinematic-card p-5 sm:p-6">
            <div className="pointer-events-none absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-purple-400/10 blur-[88px]" />
            <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
                  Workspace Overview
                </div>
                <h2 className="omnix-display mt-2 text-2xl font-semibold text-white">
                  Real-time Platform Telemetry
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--omnix-text-2)]">
                  These metrics reflect true records from the backend database for your current workspace context.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.values(realMetrics).map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </div>

          {filesError ? (
            <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
              {filesError}
            </div>
          ) : null}

          <StudioCard title="Custom Dashboards (Beta)" subtitle="Build custom reporting boards from real workspace data.">
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-6 text-center">
              <Construction className="h-9 w-9 text-cyan-200/35" />
              <p className="mt-4 text-sm font-semibold text-white">Custom boards are under construction</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-[var(--omnix-text-3)]">
                Query volume, token usage, department trends, and custom reporting will be available once the event telemetry engine is completed.
              </p>
            </div>
          </StudioCard>
        </div>
      </div>
    </section>
  );
}
