"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, Cpu, Database, LayoutDashboard, MessageSquare, RefreshCw, Server, Users, Sparkles, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageTitle } from "@/components/ui/Typography";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { IntelligenceDashboard } from "@/components/workspace/IntelligenceDashboard";

type FileData = {
  id: string;
};

type RuntimeInfo = {
  status: string;
  version: string;
  uptime_seconds: number;
  environment: string;
};

type WorkerStatus = {
  id: string;
  name: string;
  status: string;
  last_heartbeat: string;
};

type Metric = {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  color: string;
};

function StudioCard({ title, subtitle, children, className }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("relative overflow-hidden rounded-[var(--omnix-radius)] border border-white/5 bg-black/20 p-5 shadow-inner", className)}>
      <div className="relative z-10 mb-6 flex flex-col gap-1">
        <h2 className="text-[13px] font-bold tracking-wide text-white">{title}</h2>
        <p className="text-[11px] leading-relaxed text-[var(--omnix-text-3)]">{subtitle}</p>
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
  const { activeWorkspace, activeMembers, workspaces } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const data = await apiClient.get<FileData[]>("/files");
      setFiles(data);
    } catch (err) {
      setFiles([]);
      logClientError("Failed to load source metrics", err);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const loadRuntimeInfo = useCallback(async () => {
    setLoadingRuntime(true);
    setRuntimeError(null);
    try {
      const [runtime, workerList] = await Promise.all([
        apiClient.get<RuntimeInfo>("/admin/runtime/"),
        apiClient.get<WorkerStatus[]>("/admin/runtime/workers")
      ]);
      setRuntimeInfo(runtime);
      setWorkers(workerList || []);
    } catch (err) {
      setRuntimeInfo(null);
      setWorkers([]);
      setRuntimeError("Runtime telemetry is unavailable. Please try again in a moment.");
      logClientError("Failed to load runtime telemetry", err);
    } finally {
      setLoadingRuntime(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
    void loadRuntimeInfo();
  }, [loadFiles, loadRuntimeInfo, activeWorkspace?.id]);

  const realMetrics = useMemo<Metric[]>(
    () => [
      {
        label: "Conversations",
        value: conversationsLoading ? <Skeleton className="h-8 w-16 rounded-full" /> : conversations.length,
        detail: "Active sessions in workspace.",
        icon: <MessageSquare className="h-4 w-4" />,
        color: "#00FFFF",
      },
      {
        label: "Team Members",
        value: activeWorkspace?.member_count ?? activeMembers.length,
        detail: "Authorized workspace agents.",
        icon: <Users className="h-4 w-4" />,
        color: "#9b5cff",
      },
      {
        label: "Data Sources",
        value: filesLoading ? <Skeleton className="h-8 w-16 rounded-full" /> : files.length,
        detail: "Indexed knowledge assets.",
        icon: <Database className="h-4 w-4" />,
        color: "#00e87a",
      },
      {
        label: "System Uptime",
        value: loadingRuntime ? <Skeleton className="h-8 w-24 rounded-full" /> : runtimeInfo ? `${Math.floor(runtimeInfo.uptime_seconds / 3600)}h ${Math.floor((runtimeInfo.uptime_seconds % 3600) / 60)}m` : "Unavailable",
        detail: runtimeInfo?.version ? `Omnix ${runtimeInfo.version} node` : "Runtime version not reported.",
        icon: <Activity className="h-4 w-4" />,
        color: "#ffb800",
      },
      {
        label: "Active Workers",
        value: loadingRuntime ? <Skeleton className="h-8 w-16 rounded-full" /> : runtimeInfo ? workers.length : "Unavailable",
        detail: runtimeInfo ? "Workers reported by runtime telemetry." : "Worker status not reported.",
        icon: <Cpu className="h-4 w-4" />,
        color: "#ff4df4",
      },
      {
        label: "Workspaces",
        value: workspaces.length,
        detail: "Configured super-workspaces.",
        icon: <LayoutDashboard className="h-4 w-4" />,
        color: "#3366ff",
      },
    ],
    [conversations.length, conversationsLoading, activeWorkspace, activeMembers.length, files.length, filesLoading, loadingRuntime, runtimeInfo, workers.length, workspaces.length],
  );

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-6">
        <div className="omnix-page-hero">
          <div>
            <PageTitle className="omnix-gradient-text">Analytics Studio</PageTitle>
            <p className="omnix-page-subtitle">
              Live workspace telemetry and platform operational status.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshConversations({ force: true });
              void loadFiles();
              void loadRuntimeInfo();
            }}
            className="omnix-command-button flex h-10 items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-4 text-xs font-bold text-white transition hover:bg-white/10"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingRuntime && "animate-spin")} />
            Sync Dashboard
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {realMetrics.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <StudioCard title="Runtime Environment" subtitle="Operational health of the underlying service infrastructure.">
            <div className="space-y-4">
              {runtimeError ? (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{runtimeError}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 p-4">
                <div className="flex items-center gap-3">
                  <Server className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-white">Service Status</span>
                </div>
                {loadingRuntime ? (
                  <Skeleton className="h-6 w-24 rounded-full" />
                ) : (
                  <span className={cn(
                    "flex h-6 items-center rounded-full px-2.5 text-[10px] font-bold uppercase tracking-wider",
                    runtimeInfo?.status === "healthy" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                  )}>
                    {runtimeInfo?.status || "Unavailable"}
                  </span>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">Environment</p>
                  {loadingRuntime ? <Skeleton className="mt-2 h-4 w-24 rounded-full" /> : <p className="mt-1.5 text-sm font-semibold text-white capitalize">{runtimeInfo?.environment || "Not reported"}</p>}
                </div>
                <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">Version</p>
                  {loadingRuntime ? <Skeleton className="mt-2 h-4 w-20 rounded-full" /> : <p className="mt-1.5 text-sm font-semibold text-white">{runtimeInfo?.version || "Not reported"}</p>}
                </div>
              </div>

              <div className="rounded-lg border border-white/5 bg-black/40 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">Telemetry Source</p>
                  <Globe className="h-3.5 w-3.5 text-white/20" />
                </div>
                <p className="mt-1.5 text-sm font-semibold text-white">{runtimeInfo ? "Runtime API" : "Not reported"}</p>
              </div>
            </div>
          </StudioCard>

          <StudioCard title="Background Workers" subtitle="Status of ingestion and automation workers.">
            <div className="space-y-4">
              {workers.length > 0 ? (
                workers.map(worker => (
                  <div key={worker.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 p-4 transition-colors hover:bg-black/60">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-2.5 w-2.5 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40"></span>
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                      </div>
                      <span className="text-xs font-semibold text-white">{worker.name}</span>
                    </div>
                    <span className="text-[10px] text-[var(--omnix-text-3)] font-medium">
                      Pulse: {new Date(worker.last_heartbeat).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 bg-black/40 py-8 text-center">
                  <Activity className="h-6 w-6 text-white/10" />
                  <p className="mt-3 text-xs text-[var(--omnix-text-3)]">
                    Standalone workers not detected.<br/>Using integrated runtime execution.
                  </p>
                </div>
              )}
              <div className="mt-2 rounded-lg border border-cyan-500/10 bg-cyan-500/5 p-4 text-[10px] leading-relaxed text-cyan-200/70">
                <strong className="text-cyan-400">Note:</strong> Distributed workers require a Redis instance for coordination. Integrated workers handle standard ingestion.
              </div>
            </div>
          </StudioCard>
        </div>

        <section className="omnix-cinematic-card p-5 sm:p-6 overflow-hidden">
          <div className="pointer-events-none absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-cyan-400/5 blur-[88px]" />
          <div className="relative z-10">
            <div className="mb-6 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/50">
              <Sparkles className="h-3.5 w-3.5" />
              Custom Intelligence Dashboards
            </div>
            <IntelligenceDashboard />
          </div>
        </section>
      </div>
    </section>
  );
}
