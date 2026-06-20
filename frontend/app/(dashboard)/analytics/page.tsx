"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, AlertCircle, ArrowUpRight, Cpu, Database, Gauge, LayoutDashboard, MessageSquare, RefreshCw, Server, ShieldCheck, Sparkles, TrendingUp, Users, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageTitle } from "@/components/ui/Typography";
import { ApiError, apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspaceMembership, useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { IntelligenceDashboard } from "@/components/workspace/IntelligenceDashboard";
import { LiveKnowledgeGraph } from "@/components/analytics/LiveKnowledgeGraph";

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
  surface: string;
  border: string;
  halo: string;
};

const pageEase = [0.23, 1, 0.32, 1] as const;
const numberFormatter = new Intl.NumberFormat();
const workerTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

function StudioCard({ title, subtitle, children, className }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.32, ease: pageEase }}
      className={cn("relative overflow-hidden rounded-[var(--omnix-radius)] border border-white/5 bg-black/20 p-4 shadow-inner sm:p-5", className)}
    >
      <div className="relative z-10 mb-4 flex flex-col gap-1 sm:mb-6">
        <h2 className="text-[13px] font-bold tracking-wide text-white">{title}</h2>
        <p className="hidden text-[11px] leading-relaxed text-[var(--omnix-text-3)] sm:block">{subtitle}</p>
      </div>
      <div className="relative z-10">{children}</div>
    </motion.section>
  );
}

function MetricCard({ metric, index }: { metric: Metric; index: number }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      whileHover={reduceMotion ? undefined : { y: -3 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.26, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.18), ease: pageEase }}
      className="relative min-h-[6.75rem] overflow-hidden rounded-xl border border-[var(--omnix-border)] bg-black/20 p-3 transition-[border-color,background-color] duration-150 ease-out hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] sm:min-h-0 sm:p-4"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2" style={{ background: `radial-gradient(ellipse at 100% 50%, ${metric.halo} 0%, transparent 70%)` }} />
      <div className="relative z-10 flex items-center gap-2 sm:gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border sm:h-10 sm:w-10" style={{ background: metric.surface, borderColor: metric.border, color: metric.color }}>
          {metric.icon}
        </span>
        <span className="min-w-0">
          <span className="omnix-display block truncate text-lg font-bold text-white tabular-nums sm:text-2xl">{metric.value}</span>
          <span className="block truncate text-[11px] text-[var(--omnix-text-3)] sm:text-xs">{metric.label}</span>
        </span>
      </div>
      <p className="relative z-10 mt-3 hidden text-xs leading-5 text-[var(--omnix-text-3)] sm:block">{metric.detail}</p>
    </motion.article>
  );
}

function formatUptime(seconds?: number) {
  if (!seconds && seconds !== 0) return "Unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatHeartbeat(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return workerTimeFormatter.format(date);
}

function AnalysisSignalCard({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  accent: string;
}) {
  return (
    <article className="relative min-h-[7.5rem] overflow-hidden rounded-xl border border-white/5 bg-black/20 p-4 shadow-inner transition-[border-color,background-color,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-white/10 hover:bg-black/30">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 16%, transparent), transparent 46%)` }}
      />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">{label}</p>
          <div className="mt-2 truncate text-xl font-bold text-white tabular-nums">{value}</div>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: accent, color: accent, background: "rgba(255,255,255,0.035)" }}>
          {icon}
        </span>
      </div>
      <p className="relative z-10 mt-3 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-3)]">{detail}</p>
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
  const { activeWorkspace, workspaces } = useWorkspaceTree();
  const { activeMembers } = useWorkspaceMembership();
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
      if (err instanceof ApiError) {
        console.debug("Runtime telemetry unavailable", {
          endpoint: err.endpoint,
          status: err.status,
          rawMessage: err.rawMessage,
        });
      } else {
        console.debug("Runtime telemetry unavailable", err);
      }
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
        color: "var(--omnix-cyan)",
        surface: "var(--omnix-rgba-0-255-255-0-14)",
        border: "var(--omnix-rgba-0-255-255-0-28)",
        halo: "var(--omnix-rgba-0-255-255-0-14)",
      },
      {
        label: "Team Members",
        value: activeWorkspace?.member_count ?? activeMembers.length,
        detail: "Authorized workspace agents.",
        icon: <Users className="h-4 w-4" />,
        color: "var(--omnix-purple)",
        surface: "var(--omnix-rgba-155-92-255-0-14)",
        border: "var(--omnix-rgba-155-92-255-0-28)",
        halo: "var(--omnix-rgba-155-92-255-0-14)",
      },
      {
        label: "Data Sources",
        value: filesLoading ? <Skeleton className="h-8 w-16 rounded-full" /> : files.length,
        detail: "Indexed knowledge assets.",
        icon: <Database className="h-4 w-4" />,
        color: "var(--omnix-green)",
        surface: "var(--omnix-rgba-0-232-122-0-14)",
        border: "var(--omnix-rgba-0-232-122-0-28)",
        halo: "var(--omnix-rgba-0-232-122-0-14)",
      },
      {
        label: "System Uptime",
        value: loadingRuntime ? <Skeleton className="h-8 w-24 rounded-full" /> : runtimeInfo ? formatUptime(runtimeInfo.uptime_seconds) : "Unavailable",
        detail: runtimeInfo?.version ? `Omnix ${runtimeInfo.version} node` : "Runtime version not reported.",
        icon: <Activity className="h-4 w-4" />,
        color: "var(--omnix-amber)",
        surface: "var(--omnix-rgba-255-184-0-14)",
        border: "var(--omnix-rgba-255-184-0-28)",
        halo: "var(--omnix-rgba-255-184-0-14)",
      },
      {
        label: "Active Workers",
        value: loadingRuntime ? <Skeleton className="h-8 w-16 rounded-full" /> : runtimeInfo ? workers.length : "Unavailable",
        detail: runtimeInfo ? "Workers reported by runtime telemetry." : "Worker status not reported.",
        icon: <Cpu className="h-4 w-4" />,
        color: "var(--omnix-pink)",
        surface: "var(--omnix-rgba-255-77-244-0-14)",
        border: "var(--omnix-rgba-255-77-244-0-28)",
        halo: "var(--omnix-rgba-255-77-244-0-14)",
      },
      {
        label: "Workspaces",
        value: workspaces.length,
        detail: "Configured super-workspaces.",
        icon: <LayoutDashboard className="h-4 w-4" />,
        color: "var(--omnix-blue)",
        surface: "var(--omnix-rgba-51-102-255-0-14)",
        border: "var(--omnix-rgba-51-102-255-0-28)",
        halo: "var(--omnix-rgba-51-102-255-0-14)",
      },
    ],
    [conversations.length, conversationsLoading, activeWorkspace, activeMembers.length, files.length, filesLoading, loadingRuntime, runtimeInfo, workers.length, workspaces.length],
  );

  const analysisSignals = useMemo(
    () => [
      {
        label: "Workspace Coverage",
        value: filesLoading ? <Skeleton className="h-7 w-14 rounded-full" /> : numberFormatter.format(files.length),
        detail: activeWorkspace ? `${activeWorkspace.name} knowledge sources visible to this workspace.` : "No active workspace selected.",
        icon: <ShieldCheck className="h-4 w-4" />,
        accent: "var(--omnix-green)",
      },
      {
        label: "Engagement Signal",
        value: conversationsLoading ? <Skeleton className="h-7 w-14 rounded-full" /> : numberFormatter.format(conversations.length + activeMembers.length),
        detail: "Combined conversation and member signal for the current operating window.",
        icon: <TrendingUp className="h-4 w-4" />,
        accent: "var(--omnix-cyan)",
      },
      {
        label: "Runtime Confidence",
        value: loadingRuntime ? <Skeleton className="h-7 w-20 rounded-full" /> : runtimeInfo?.status === "healthy" ? "Healthy" : runtimeError ? "Limited" : "Unavailable",
        detail: runtimeInfo ? `Runtime ${runtimeInfo.version || "version unknown"} reporting from ${runtimeInfo.environment || "unknown"} environment.` : "Runtime telemetry could not be confirmed.",
        icon: <Gauge className="h-4 w-4" />,
        accent: runtimeInfo?.status === "healthy" ? "var(--omnix-green)" : "var(--omnix-amber)",
      },
    ],
    [activeMembers.length, activeWorkspace, conversations.length, conversationsLoading, files.length, filesLoading, loadingRuntime, runtimeError, runtimeInfo],
  );

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-6">
        <div className="relative overflow-hidden rounded-[var(--omnix-radius-lg)] border border-cyan-300/10 bg-[linear-gradient(135deg,rgba(0,255,255,0.105),rgba(124,92,255,0.065),rgba(0,0,0,0.18))] p-4 shadow-[var(--omnix-glow-xs)] sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.045),transparent)]" />
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" />
                Analysis Studio
              </p>
              <PageTitle className="omnix-gradient-text">Workspace Intelligence</PageTitle>
              <p className="omnix-page-subtitle max-w-3xl text-pretty">
                Live telemetry, knowledge coverage, runtime confidence, and AI usage patterns in one operating view.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void refreshConversations({ force: true });
                void loadFiles();
                void loadRuntimeInfo();
              }}
              className="omnix-command-button flex h-11 items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/5 px-4 text-xs font-bold text-white transition-[background,border-color,box-shadow,transform] duration-150 ease-out hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-fit"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loadingRuntime && "animate-spin")} />
              Sync Analysis
              <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {analysisSignals.map((signal) => (
            <AnalysisSignalCard key={signal.label} {...signal} />
          ))}
        </div>

        <LiveKnowledgeGraph
          conversationCount={conversations.length}
          memberCount={activeWorkspace?.member_count ?? activeMembers.length}
          sourceCount={files.length}
          workspaceCount={workspaces.length}
          workerCount={workers.length}
          runtimeStatus={runtimeInfo?.status ?? (runtimeError ? "limited" : "unavailable")}
        />

        <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {realMetrics.map((metric, index) => (
            <MetricCard key={metric.label} metric={metric} index={index} />
          ))}
        </div>

        <div className="grid gap-3 sm:gap-6 lg:grid-cols-2">
          <StudioCard title="Runtime Environment" subtitle="Operational health of the underlying service infrastructure.">
            <div className="space-y-3 sm:space-y-4">
              {runtimeError ? (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{runtimeError}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/40 p-3 sm:p-4">
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
              
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="rounded-lg border border-white/5 bg-black/40 p-3 sm:p-4">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">Environment</p>
                  {loadingRuntime ? <Skeleton className="mt-2 h-4 w-24 rounded-full" /> : <p className="mt-1.5 text-sm font-semibold text-white capitalize">{runtimeInfo?.environment || "Not reported"}</p>}
                </div>
                <div className="rounded-lg border border-white/5 bg-black/40 p-3 sm:p-4">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">Version</p>
                  {loadingRuntime ? <Skeleton className="mt-2 h-4 w-20 rounded-full" /> : <p className="mt-1.5 text-sm font-semibold text-white">{runtimeInfo?.version || "Not reported"}</p>}
                </div>
              </div>

              <div className="rounded-lg border border-white/5 bg-black/40 p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">Telemetry Source</p>
                  <Globe className="h-3.5 w-3.5 text-white/20" />
                </div>
                <p className="mt-1.5 text-sm font-semibold text-white">{runtimeInfo ? "Runtime API" : "Not reported"}</p>
              </div>
            </div>
          </StudioCard>

          <StudioCard title="Background Workers" subtitle="Status of ingestion and automation workers.">
            <div className="space-y-3 sm:space-y-4">
              {workers.length > 0 ? (
                workers.map(worker => (
                  <div key={worker.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/40 p-3 transition-colors hover:bg-black/60 sm:p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative flex h-2.5 w-2.5 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40"></span>
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                      </div>
                      <span className="truncate text-xs font-semibold text-white">{worker.name}</span>
                    </div>
                    <span className="shrink-0 text-[10px] font-medium text-[var(--omnix-text-3)]">
                      Pulse: {formatHeartbeat(worker.last_heartbeat)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center gap-3 rounded-lg border border-white/5 bg-black/40 px-4 py-4 text-center sm:flex-col sm:py-8">
                  <Activity className="h-5 w-5 text-white/10 sm:h-6 sm:w-6" />
                  <p className="text-xs text-[var(--omnix-text-3)] sm:mt-3">
                    Standalone workers not detected.<span className="hidden sm:inline"><br/>Using integrated runtime execution.</span>
                  </p>
                </div>
              )}
              <div className="mt-2 hidden rounded-lg border border-cyan-500/10 bg-cyan-500/5 p-4 text-[10px] leading-relaxed text-cyan-200/70 sm:block">
                <strong className="text-cyan-400">Note:</strong> Distributed workers require a Redis instance for coordination. Integrated workers handle standard ingestion.
              </div>
            </div>
          </StudioCard>
        </div>

        <section className="omnix-cinematic-card overflow-hidden p-3 sm:p-6">
          <div className="pointer-events-none absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-cyan-400/5 blur-[88px]" />
          <div className="relative z-10">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/50 sm:mb-6">
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
