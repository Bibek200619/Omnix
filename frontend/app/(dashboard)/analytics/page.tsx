"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, LayoutDashboard, MessageSquare, RefreshCw, Sparkles, Users, Zap, Construction, Activity, Server, Cpu, Globe } from "lucide-react";
import { PageTitle } from "@/components/ui/Typography";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

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
  value: string | number;
  detail: string;
  icon: ReactNode;
  color: string;
};

function StudioCard({ title, subtitle, children, className }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("relative overflow-hidden rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.1)] bg-[linear-gradient(145deg,rgba(0,255,255,0.055),rgba(155,92,255,0.028)_52%,rgba(0,0,0,0.16))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.035)]", className)}>
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
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [loadingRuntime, setLoadingRuntime] = useState(false);

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
    try {
      const [runtime, workerList] = await Promise.all([
        apiClient.get<RuntimeInfo>("/admin/runtime/"),
        apiClient.get<WorkerStatus[]>("/admin/runtime/workers")
      ]);
      setRuntimeInfo(runtime);
      setWorkers(workerList || []);
    } catch (err) {
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
        value: conversationsLoading ? "..." : conversations.length,
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
        value: filesLoading ? "..." : files.length,
        detail: "Indexed knowledge assets.",
        icon: <Database className="h-4 w-4" />,
        color: "#00e87a",
      },
      {
        label: "System Uptime",
        value: runtimeInfo ? `${Math.floor(runtimeInfo.uptime_seconds / 3600)}h ${Math.floor((runtimeInfo.uptime_seconds % 3600) / 60)}m` : "...",
        detail: `Omnix ${runtimeInfo?.version || "v1.0"} Node`,
        icon: <Activity className="h-4 w-4" />,
        color: "#ffb800",
      },
      {
        label: "Active Workers",
        value: workers.length || (runtimeInfo?.status === "healthy" ? "1" : "0"),
        detail: "Operational background agents.",
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
    [conversations.length, conversationsLoading, activeWorkspace, activeMembers.length, files.length, filesLoading, runtimeInfo, workers.length, workspaces.length],
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
              <div className="flex items-center justify-between rounded-lg bg-black/20 p-3">
                <div className="flex items-center gap-3">
                  <Server className="h-4 w-4 text-cyan-300" />
                  <span className="text-xs font-medium text-white">Service Status</span>
                </div>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  runtimeInfo?.status === "healthy" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                )}>
                  {runtimeInfo?.status || "Connecting..."}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--omnix-text-3)]">Environment</p>
                  <p className="mt-1 text-sm font-bold text-white capitalize">{runtimeInfo?.environment || "Development"}</p>
                </div>
                <div className="rounded-lg bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--omnix-text-3)]">Platform Port</p>
                  <p className="mt-1 text-sm font-bold text-white">8000</p>
                </div>
              </div>

              <div className="rounded-lg bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--omnix-text-3)]">Data Residency</p>
                  <Globe className="h-3 w-3 text-white/20" />
                </div>
                <p className="mt-1 text-sm font-bold text-white">Local / Supabase Federated</p>
              </div>
            </div>
          </StudioCard>

          <StudioCard title="Background Workers" subtitle="Status of ingestion and automation workers.">
            <div className="space-y-3">
              {workers.length > 0 ? (
                workers.map(worker => (
                  <div key={worker.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/10 p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                      <span className="text-xs font-medium text-white">{worker.name}</span>
                    </div>
                    <span className="text-[10px] text-[var(--omnix-text-3)]">
                      Last pulse: {new Date(worker.last_heartbeat).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Activity className="h-8 w-8 text-white/5" />
                  <p className="mt-3 text-xs text-[var(--omnix-text-3)]">
                    Standalone workers not detected.<br/>Using integrated runtime execution.
                  </p>
                </div>
              )}
              <div className="mt-2 rounded-lg bg-cyan-300/5 p-3 text-[10px] leading-relaxed text-cyan-200/60">
                <strong>Note:</strong> Distributed workers require a Redis instance for coordination. Integrated workers handle standard ingestion.
              </div>
            </div>
          </StudioCard>
        </div>

        <section className="omnix-cinematic-card p-5 sm:p-6 overflow-hidden">
          <div className="pointer-events-none absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-cyan-400/5 blur-[88px]" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/50">
              <Construction className="h-3.5 w-3.5" />
              Intelligence Roadmap
            </div>
            <h3 className="omnix-display mt-2 text-lg font-semibold text-white">Custom Intelligence Dashboards</h3>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--omnix-text-2)]">
              We are building a custom widget engine to allow you to pin specific conversation trends, source growth charts, and AI token utilization to this studio.
            </p>
            <div className="mt-5 flex gap-2">
              <div className="h-1 flex-1 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full w-2/3 bg-cyan-300/40" />
              </div>
              <span className="text-[9px] font-bold text-cyan-300/60 uppercase tracking-widest">In Development</span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
