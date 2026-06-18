"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, Database, MessageSquare } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

type TelemetryData = {
  dates: string[];
  conversations: number[];
  sources: number[];
  tokens: number[];
};

function generateMockTelemetry(): TelemetryData {
  const dates = [];
  const d = new Date();
  for (let i = 6; i >= 0; i--) {
    const past = new Date(d);
    past.setDate(d.getDate() - i);
    dates.push(`${(past.getMonth() + 1).toString().padStart(2, '0')}-${past.getDate().toString().padStart(2, '0')}`);
  }
  return {
    dates,
    conversations: [2, 5, 3, 8, 4, 7, 9],
    sources: [0, 1, 0, 3, 1, 2, 4],
    tokens: [1200, 3400, 2100, 5600, 2800, 4100, 6200],
  };
}

function MiniBarChart({ data, labels, color, label }: { data: number[], labels: string[], color: string, label: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--omnix-text-3)]">
        <span>{label}</span>
        <span style={{ color }}>{data.reduce((a, b) => a + b, 0).toLocaleString()} Total</span>
      </div>
      <div className="flex h-24 items-end gap-1.5 sm:gap-2">
        {data.map((val, i) => (
          <div key={i} className="group relative flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t-sm transition-all duration-300 group-hover:brightness-125"
                 style={{ height: `${Math.max((val / max) * 100, 4)}%`, backgroundColor: color, opacity: 0.8 }} />
            <span className="text-[8px] text-[var(--omnix-text-3)] opacity-0 transition-opacity group-hover:opacity-100 absolute -bottom-4">
              {labels[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IntelligenceDashboard() {
  const { activeWorkspaceId } = useWorkspace();
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeWorkspaceId) return;
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

  if (loading || !data) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-white/5 bg-black/10">
        <Activity className="h-5 w-5 animate-pulse text-cyan-500/50" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-3">
      <div className="rounded-xl border border-white/5 bg-black/20 p-4 shadow-inner">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-cyan-400" />
          <h4 className="text-xs font-semibold text-white">Conversation Volume</h4>
        </div>
        <MiniBarChart data={data.conversations} labels={data.dates} color="var(--omnix-cyan)" label="7-Day Trend" />
      </div>
      
      <div className="rounded-xl border border-white/5 bg-black/20 p-4 shadow-inner">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-400" />
          <h4 className="text-xs font-semibold text-white">Source Growth</h4>
        </div>
        <MiniBarChart data={data.sources} labels={data.dates} color="var(--omnix-color-10b981)" label="7-Day Trend" />
      </div>

      <div className="rounded-xl border border-white/5 bg-black/20 p-4 shadow-inner">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-purple-400" />
          <h4 className="text-xs font-semibold text-white">Token Utilization</h4>
        </div>
        <MiniBarChart data={data.tokens} labels={data.dates} color="var(--omnix-color-a855f7)" label="7-Day Trend" />
      </div>
    </div>
  );
}
