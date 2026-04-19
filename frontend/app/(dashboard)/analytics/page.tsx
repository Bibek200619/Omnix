"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { BarChart2, Database, Filter, TrendingUp, Users, Zap } from "lucide-react";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";

const timeRanges = ["24h", "7d", "30d", "90d"];

const queryVolumeData = [
  { day: "Mon", queries: 2400, success: 2300 },
  { day: "Tue", queries: 3200, success: 3100 },
  { day: "Wed", queries: 2800, success: 2700 },
  { day: "Thu", queries: 4100, success: 3950 },
  { day: "Fri", queries: 3700, success: 3620 },
  { day: "Sat", queries: 1800, success: 1770 },
  { day: "Sun", queries: 1400, success: 1380 },
];

const tokenData = [
  { hour: "00", tokens: 1200 },
  { hour: "02", tokens: 800 },
  { hour: "04", tokens: 600 },
  { hour: "06", tokens: 900 },
  { hour: "08", tokens: 3200 },
  { hour: "10", tokens: 5600 },
  { hour: "12", tokens: 4800 },
  { hour: "14", tokens: 7200 },
  { hour: "16", tokens: 6400 },
  { hour: "18", tokens: 8100 },
  { hour: "20", tokens: 5200 },
  { hour: "22", tokens: 3400 },
];

const topicData = [
  { name: "Research", value: 38, color: "#00FFFF" },
  { name: "Code", value: 25, color: "#9b5cff" },
  { name: "Analysis", value: 18, color: "#00e87a" },
  { name: "Writing", value: 12, color: "#ffb800" },
  { name: "Other", value: 7, color: "#ff3b5c" },
];

const topSources = [
  { name: "Company Wiki", queries: 4280, pct: 92, color: "#00FFFF" },
  { name: "Product Docs", queries: 3120, pct: 71, color: "#9b5cff" },
  { name: "Slack Channels", queries: 2490, pct: 58, color: "#00e87a" },
  { name: "GitHub Repos", queries: 1870, pct: 44, color: "#ffb800" },
  { name: "Notion Pages", queries: 1340, pct: 32, color: "#ff4df4" },
];

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.08)] bg-[rgba(0,255,255,0.03)] p-5 transition hover:border-[rgba(0,255,255,0.15)] hover:shadow-[0_0_20px_rgba(0,255,255,0.05)]">
      <div className="pointer-events-none absolute -right-5 -top-5 h-[120px] w-[120px] rounded-full bg-[radial-gradient(circle,rgba(0,255,255,0.04)_0%,transparent_70%)]" />
      <h2 className="omnix-display relative z-10 text-sm font-bold text-white">{title}</h2>
      <p className="relative z-10 mt-1 mb-4 text-[11px] text-white/35">{subtitle}</p>
      <div className="relative z-10">{children}</div>
    </section>
  );
}

export default function AnalyticsPage() {
  const [activeRange, setActiveRange] = useState("7d");
  const { conversations } = useConversationHistory();
  const { activeWorkspace } = useWorkspace();
  const totalQueries = Math.max(18420, conversations.length * 128);
  const activeUsers = activeWorkspace?.member_count ?? 1;
  const maxQueries = Math.max(...queryVolumeData.map((item) => item.queries));
  const maxTokens = Math.max(...tokenData.map((item) => item.tokens));

  const kpiCards = useMemo(
    () => [
      { label: "Total Queries", value: totalQueries.toLocaleString(), change: "+22%", Icon: Zap, color: "#00FFFF" },
      { label: "Active Users", value: activeUsers.toLocaleString(), change: "+8%", Icon: Users, color: "#9b5cff" },
      { label: "Avg Response", value: "1.2s", change: "-0.3s", Icon: TrendingUp, color: "#00e87a" },
      { label: "Sources Used", value: "1,283", change: "+34%", Icon: Database, color: "#ffb800" },
    ],
    [activeUsers, totalQueries],
  );

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex gap-0.5 rounded-[10px] border border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.03)] p-[3px]">
            {timeRanges.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setActiveRange(range)}
                className="rounded-[7px] px-3.5 py-1.5 text-xs font-semibold transition"
                style={{
                  background: activeRange === range ? "rgba(0,255,255,0.12)" : "transparent",
                  border: activeRange === range ? "1px solid rgba(0,255,255,0.28)" : "1px solid transparent",
                  color: activeRange === range ? "var(--omnix-cyan)" : "rgba(255,255,255,0.3)",
                  boxShadow: activeRange === range ? "var(--omnix-glow-xs)" : "none",
                }}
              >
                {range}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.03)] px-3.5 text-xs text-white/40 transition hover:border-[rgba(0,255,255,0.25)] hover:text-white"
          >
            <Filter className="h-3 w-3" />
            Filter
          </button>
        </div>

        <div className="grid gap-[13px] md:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map((card, index) => {
            const Icon = card.Icon;
            return (
              <article
                key={card.label}
                className="relative overflow-hidden rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.08)] bg-[rgba(0,255,255,0.03)] p-[18px] transition hover:-translate-y-0.5 hover:shadow-[0_0_26px_rgba(0,255,255,0.1),0_4px_20px_rgba(0,0,0,0.3)]"
                style={{ animation: `omnix-card-enter 0.4s ease ${index * 80}ms both` }}
              >
                <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2" style={{ background: `radial-gradient(ellipse at 100% 50%, ${card.color}09 0%, transparent 70%)` }} />
                <div className="relative z-10 mb-3 flex items-center justify-between">
                  <span
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border"
                    style={{ background: `${card.color}12`, borderColor: `${card.color}28`, boxShadow: `0 0 10px ${card.color}18` }}
                  >
                    <Icon className="h-[15px] w-[15px]" style={{ color: card.color }} />
                  </span>
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold text-[var(--omnix-green)]">
                    {card.change}
                  </span>
                </div>
                <div className="omnix-display relative z-10 mb-1 text-[26px] font-extrabold leading-none text-white">{card.value}</div>
                <p className="relative z-10 text-[11px] text-white/35">{card.label}</p>
              </article>
            );
          })}
        </div>

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_290px]">
          <ChartCard title="Query Volume" subtitle="Queries and success rate over time">
            <div className="flex h-[170px] items-end gap-2 border-b border-white/[0.06] px-1 pb-5">
              {queryVolumeData.map((item) => (
                <div key={item.day} className="flex h-full flex-1 flex-col justify-end gap-1">
                  <div className="flex flex-1 items-end gap-1">
                    <span className="w-full rounded-t bg-[linear-gradient(180deg,rgba(0,255,255,0.3),rgba(0,255,255,0.05))]" style={{ height: `${(item.queries / maxQueries) * 100}%` }} />
                    <span className="w-full rounded-t bg-[#00FFFF] opacity-85 shadow-[0_0_10px_rgba(0,255,255,0.3)]" style={{ height: `${(item.success / maxQueries) * 100}%` }} />
                  </div>
                  <span className="text-center text-[11px] text-white/30">{item.day}</span>
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Topics" subtitle="Query breakdown by type">
            <div className="mx-auto h-[130px] w-[130px] rounded-full p-[18px]" style={{ background: "conic-gradient(#00FFFF 0 38%, #9b5cff 38% 63%, #00e87a 63% 81%, #ffb800 81% 93%, #ff3b5c 93% 100%)" }}>
              <div className="flex h-full w-full items-center justify-center rounded-full bg-[#071220] text-center">
                <BarChart2 className="h-5 w-5 text-[var(--omnix-cyan)]" />
              </div>
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {topicData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color, boxShadow: `0 0 6px ${item.color}60` }} />
                  <span className="flex-1 text-[11px] text-white/45">{item.name}</span>
                  <span className="text-[11px] text-white/30">{item.value}%</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <div className="grid gap-3.5 xl:grid-cols-2">
          <ChartCard title="Token Usage" subtitle="Tokens consumed hourly">
            <div className="flex h-[150px] items-end gap-1.5 border-b border-white/[0.06] px-1 pb-5">
              {tokenData.map((item) => (
                <div key={item.hour} className="flex h-full flex-1 flex-col justify-end gap-1">
                  <span
                    className="rounded-t bg-[linear-gradient(180deg,rgba(155,92,255,0.85),rgba(155,92,255,0.08))] shadow-[0_0_10px_rgba(155,92,255,0.18)]"
                    style={{ height: `${(item.tokens / maxTokens) * 100}%` }}
                  />
                  <span className="text-center text-[10px] text-white/30">{item.hour}</span>
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="User Growth" subtitle="Active and new users by week">
            <div className="grid h-[150px] grid-cols-4 items-end gap-4 border-b border-white/[0.06] px-3 pb-5">
              {[
                { week: "W1", active: 62, fresh: 24 },
                { week: "W2", active: 74, fresh: 31 },
                { week: "W3", active: 69, fresh: 21 },
                { week: "W4", active: 88, fresh: 40 },
              ].map((item) => (
                <div key={item.week} className="flex h-full flex-col justify-end gap-2">
                  <div className="flex flex-1 items-end gap-2">
                    <span className="w-full rounded-t bg-[#00e87a] shadow-[0_0_8px_rgba(0,232,122,0.3)]" style={{ height: `${item.active}%` }} />
                    <span className="w-full rounded-t bg-[#00FFFF] shadow-[0_0_8px_rgba(0,255,255,0.3)]" style={{ height: `${item.fresh}%` }} />
                  </div>
                  <span className="text-center text-[11px] text-white/30">{item.week}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <ChartCard title="Top Knowledge Sources" subtitle="Most queried data sources this period">
          <div className="flex flex-col gap-[13px]">
            {topSources.map((source, index) => (
              <div key={source.name} className="flex items-center gap-3.5">
                <span
                  className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[10px] font-extrabold"
                  style={{ background: `${source.color}15`, borderColor: `${source.color}25`, color: source.color }}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1.5 flex justify-between gap-3">
                    <span className="truncate text-xs font-semibold text-white">{source.name}</span>
                    <span className="shrink-0 text-[11px] text-white/35">{source.queries.toLocaleString()} queries</span>
                  </span>
                  <span className="block h-[5px] overflow-hidden rounded bg-white/[0.05]">
                    <span
                      className="block h-full rounded transition-[width] duration-1000"
                      style={{ width: `${source.pct}%`, background: `linear-gradient(90deg, ${source.color}cc, ${source.color})`, boxShadow: `0 0 8px ${source.color}60` }}
                    />
                  </span>
                </span>
                <span className="w-9 text-right text-[11px] font-bold" style={{ color: source.color }}>{source.pct}%</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </section>
  );
}
