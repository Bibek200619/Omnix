"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, BarChart3, Database, MessageSquare, TrendingUp } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

type TelemetryData = {
  dates: string[];
  conversations: number[];
  sources: number[];
  tokens: number[];
};

function generateMockTelemetry(): TelemetryData {
  const dates = [];
  const d = new Date();
  const formatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit" });
  for (let i = 6; i >= 0; i--) {
    const past = new Date(d);
    past.setDate(d.getDate() - i);
    dates.push(formatter.format(past));
  }
  return {
    dates,
    conversations: [2, 5, 3, 8, 4, 7, 9],
    sources: [0, 1, 0, 3, 1, 2, 4],
    tokens: [1200, 3400, 2100, 5600, 2800, 4100, 6200],
  };
}

const numberFormatter = new Intl.NumberFormat();

function total(data: number[]) {
  return data.reduce((sum, value) => sum + value, 0);
}

function MiniBarChart({
  data,
  labels,
  color,
  label,
  compact = false,
}: {
  data: number[];
  labels: string[];
  color: string;
  label: string;
  compact?: boolean;
}) {
  const max = Math.max(...data, 1);
  const chartLabel = `${label} trend: ${data.map((val, i) => `${labels[i]} ${numberFormatter.format(val)}`).join(", ")}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2 text-[9px] uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
        <span className="truncate">{label}</span>
        <span className="shrink-0" style={{ color }}>{numberFormatter.format(total(data))}</span>
      </div>
      <div
        role="img"
        aria-label={chartLabel}
        className={cn(
          "grid grid-cols-7 items-end gap-1 rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5",
          compact ? "h-10" : "h-12 sm:h-14",
        )}
      >
        {data.map((val, i) => (
          <div key={`${labels[i]}-${i}`} className="flex h-full min-w-0 items-end" title={`${labels[i]}: ${numberFormatter.format(val)}`}>
            <div
              className="w-full rounded-sm transition-[filter,height] duration-300 hover:brightness-125"
              style={{ height: `${Math.max((val / max) * 100, val > 0 ? 8 : 2)}%`, backgroundColor: color, opacity: val > 0 ? 0.9 : 0.22 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendCard({
  title,
  value,
  detail,
  color,
  children,
}: {
  title: string;
  value: string;
  detail: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-white/5 bg-black/20 p-3 shadow-inner transition-colors duration-150 ease-out hover:border-white/10 hover:bg-black/30">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-xs font-semibold text-white">{title}</h4>
          <p className="mt-1 truncate text-[10px] text-[var(--omnix-text-3)]">{detail}</p>
        </div>
        <div className="shrink-0 rounded-lg border px-2 py-1 text-xs font-bold tabular-nums" style={{ borderColor: color, color, background: "rgba(255,255,255,0.025)" }}>
          {value}
        </div>
      </div>
      {children}
    </section>
  );
}

export function IntelligenceDashboard() {
  const { activeWorkspaceId } = useWorkspaceTree();
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setData(generateMockTelemetry());
      setLoading(false);
      return;
    }
    let isMounted = true;
    setLoading(true);

    apiClient.get<TelemetryData>(`/workspaces/${activeWorkspaceId}/telemetry`)
      .then(res => {
        if (isMounted) setData(res);
      })
      .catch(err => {
        console.warn("Telemetry API unavailable, falling back to local simulation.", err);
        if (isMounted) setData(generateMockTelemetry());
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [activeWorkspaceId]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      conversations: total(data.conversations),
      sources: total(data.sources),
      tokens: total(data.tokens),
      latestConversations: data.conversations.at(-1) ?? 0,
      latestSources: data.sources.at(-1) ?? 0,
      latestTokens: data.tokens.at(-1) ?? 0,
    };
  }, [data]);

  if (loading || !data) {
    return (
      <div className="grid min-h-32 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="flex min-h-24 items-center justify-center rounded-xl border border-white/5 bg-black/20">
          <Activity className="h-5 w-5 animate-pulse text-cyan-500/50" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-xl border border-white/5 bg-white/[0.035]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
      <section className="min-w-0 rounded-xl border border-white/5 bg-black/20 p-3 shadow-inner sm:p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/60">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              7-Day Workspace Trend
            </div>
            <h3 className="mt-1.5 text-base font-semibold text-white">Operational Telemetry</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[17rem]">
            {[
              { label: "Chats", value: totals?.latestConversations ?? 0, color: "var(--omnix-cyan)" },
              { label: "Sources", value: totals?.latestSources ?? 0, color: "var(--omnix-green)" },
              { label: "Tokens", value: totals?.latestTokens ?? 0, color: "var(--omnix-purple)" },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-lg border border-white/5 bg-white/[0.035] px-2.5 py-2 text-right">
                <div className="truncate text-[9px] uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{item.label}</div>
                <div className="mt-1 truncate text-sm font-bold tabular-nums text-white" style={{ color: item.color }}>{numberFormatter.format(item.value)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniBarChart data={data.conversations} labels={data.dates} color="var(--omnix-cyan)" label="Conversations" compact />
          <MiniBarChart data={data.sources} labels={data.dates} color="var(--omnix-green)" label="Sources" compact />
          <MiniBarChart data={data.tokens} labels={data.dates} color="var(--omnix-purple)" label="Tokens" compact />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <TrendCard
          title="Conversation Volume"
          value={numberFormatter.format(totals?.conversations ?? 0)}
          detail="Total 7-day sessions"
          color="var(--omnix-cyan)"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            <MiniBarChart data={data.conversations} labels={data.dates} color="var(--omnix-cyan)" label="Daily" compact />
          </div>
        </TrendCard>
        <TrendCard
          title="Source Growth"
          value={numberFormatter.format(totals?.sources ?? 0)}
          detail="New indexed assets"
          color="var(--omnix-green)"
        >
          <div className="flex items-center gap-3">
            <Database className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
            <MiniBarChart data={data.sources} labels={data.dates} color="var(--omnix-green)" label="Daily" compact />
          </div>
        </TrendCard>
        <TrendCard
          title="Token Utilization"
          value={numberFormatter.format(totals?.tokens ?? 0)}
          detail="Estimated usage trend"
          color="var(--omnix-purple)"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="h-4 w-4 shrink-0 text-purple-300" aria-hidden="true" />
            <MiniBarChart data={data.tokens} labels={data.dates} color="var(--omnix-purple)" label="Daily" compact />
          </div>
        </TrendCard>
      </div>
    </div>
  );
}
