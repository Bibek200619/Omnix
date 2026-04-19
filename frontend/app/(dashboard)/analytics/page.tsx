"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, Database, LayoutDashboard, MessageSquare, RefreshCw, Save, Sparkles, Trash2, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";

type FileData = {
  id: string;
};

type AnalyticsBoard = {
  id: string;
  title: string;
  query: string;
  createdAt: string;
};

type Metric = {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  color: string;
};

function boardStorageKey(workspaceId?: string | null) {
  return `omnix.analyticsBoards.${workspaceId ?? "global"}`;
}

function readBoards(workspaceId?: string | null): AnalyticsBoard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(boardStorageKey(workspaceId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBoards(workspaceId: string | null | undefined, boards: AnalyticsBoard[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(boardStorageKey(workspaceId), JSON.stringify(boards));
}

function StudioCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.1)] bg-[linear-gradient(145deg,rgba(0,255,255,0.055),rgba(155,92,255,0.028)_52%,rgba(0,0,0,0.16))] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-cyan-300/10 blur-[70px]" />
      <div className="relative z-10 mb-4">
        <h2 className="omnix-display text-sm font-bold text-white">{title}</h2>
        <p className="mt-1 text-[11px] leading-5 text-[var(--omnix-text-3)]">{subtitle}</p>
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
  const { conversations, loading: conversationsLoading, refreshConversations } = useConversationHistory();
  const { activeWorkspace, activeMembers, activeInvites, workspaces } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [boards, setBoards] = useState<AnalyticsBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>("overview");
  const [boardTitle, setBoardTitle] = useState("");
  const [boardQuery, setBoardQuery] = useState("");

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const data = await apiClient.get<FileData[]>("/files");
      setFiles(data);
    } catch (err) {
      setFiles([]);
      setFilesError(err instanceof Error ? err.message : "Unable to load source metrics");
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, activeWorkspace?.id]);

  useEffect(() => {
    const saved = readBoards(activeWorkspace?.id);
    setBoards(saved);
    setActiveBoardId((current) => (current === "overview" || saved.some((board) => board.id === current) ? current : "overview"));
  }, [activeWorkspace?.id]);

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

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? null;
  const activeQuery = activeBoard?.query ?? "workspace overview conversations members sources invites";

  const selectedMetrics = useMemo(() => {
    const query = activeQuery.toLowerCase();
    const picked: Metric[] = [];
    const add = (key: keyof typeof realMetrics) => {
      if (!picked.includes(realMetrics[key])) picked.push(realMetrics[key]);
    };

    if (query.includes("team") || query.includes("member") || query.includes("department") || query.includes("activity")) add("members");
    if (query.includes("source") || query.includes("file") || query.includes("knowledge") || query.includes("repository")) add("sources");
    if (query.includes("ai") || query.includes("chat") || query.includes("conversation") || query.includes("usage")) add("conversations");
    if (query.includes("invite") || query.includes("access")) add("invites");
    if (query.includes("workspace") || query.includes("quota") || query.includes("department")) add("workspaces");

    return picked.length ? picked : [realMetrics.conversations, realMetrics.members, realMetrics.sources, realMetrics.invites];
  }, [activeQuery, realMetrics]);

  function saveBoard() {
    const title = boardTitle.trim();
    const query = boardQuery.trim();
    if (!title || !query) return;
    const nextBoard: AnalyticsBoard = {
      id: crypto.randomUUID(),
      title,
      query,
      createdAt: new Date().toISOString(),
    };
    const nextBoards = [nextBoard, ...boards];
    setBoards(nextBoards);
    setActiveBoardId(nextBoard.id);
    writeBoards(activeWorkspace?.id, nextBoards);
    setBoardTitle("");
    setBoardQuery("");
  }

  function deleteBoard(boardId: string) {
    const nextBoards = boards.filter((board) => board.id !== boardId);
    setBoards(nextBoards);
    writeBoards(activeWorkspace?.id, nextBoards);
    setActiveBoardId("overview");
  }

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-5">
        <div className="omnix-page-hero">
          <div>
            <h1 className="omnix-page-title omnix-gradient-text">Analytics Studio</h1>
            <p className="omnix-page-subtitle">
              Build custom reporting boards from real workspace data. Empty widgets stay honest until backend telemetry exists.
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

        <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="space-y-4">
            <StudioCard title="Create Board" subtitle="Describe the metrics you want to see. Boards are saved locally per workspace until a backend model exists.">
              <div className="space-y-3">
                <input
                  value={boardTitle}
                  onChange={(event) => setBoardTitle(event.target.value)}
                  placeholder="Board title"
                  className="omnix-input h-10 w-full rounded-lg px-3 text-sm"
                />
                <textarea
                  value={boardQuery}
                  onChange={(event) => setBoardQuery(event.target.value)}
                  placeholder="Example: AI usage by workspace, source usage board, team activity board..."
                  rows={4}
                  className="omnix-input w-full resize-none rounded-lg px-3 py-2 text-sm"
                />
                <Button
                  type="button"
                  className="w-full"
                  leftIcon={<Save className="h-4 w-4" />}
                  disabled={!boardTitle.trim() || !boardQuery.trim()}
                  onClick={saveBoard}
                >
                  Save board
                </Button>
              </div>
            </StudioCard>

            <StudioCard title="Boards" subtitle="Saved reporting views">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setActiveBoardId("overview")}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                    activeBoardId === "overview"
                      ? "border-cyan-300/30 bg-cyan-300/10 text-white"
                      : "border-[var(--omnix-border)] bg-black/15 text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)]"
                  }`}
                >
                  <BarChart2 className="h-4 w-4 text-cyan-200" />
                  Workspace overview
                </button>
                {boards.map((board) => (
                  <div key={board.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveBoardId(board.id)}
                      className={`min-w-0 flex-1 rounded-xl border px-3 py-3 text-left transition ${
                        activeBoardId === board.id
                          ? "border-cyan-300/30 bg-cyan-300/10 text-white"
                          : "border-[var(--omnix-border)] bg-black/15 text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)]"
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold">{board.title}</span>
                      <span className="mt-1 block truncate text-[11px] text-[var(--omnix-text-3)]">{board.query}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBoard(board.id)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-rose-300/20 bg-rose-400/10 text-rose-100 transition hover:bg-rose-400/20"
                      aria-label={`Delete ${board.title}`}
                      title={`Delete ${board.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </StudioCard>
          </aside>

          <div className="space-y-5">
            <section className="omnix-cinematic-card p-5 sm:p-6">
              <div className="pointer-events-none absolute right-[-6rem] top-[-6rem] h-72 w-72 rounded-full bg-purple-400/10 blur-[88px]" />
              <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">
                    <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
                    Active board
                  </div>
                  <h2 className="omnix-display mt-2 text-2xl font-semibold text-white">
                    {activeBoard?.title ?? "Workspace overview"}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--omnix-text-2)]">
                    {activeBoard?.query ?? "A real-data summary of conversations, members, sources, invites, and workspaces."}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {selectedMetrics.map((metric) => (
                <MetricCard key={metric.label} metric={metric} />
              ))}
            </div>

            {filesError ? (
              <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
                {filesError}
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              <StudioCard title="Flexible Widget Area" subtitle="Charts remain empty until corresponding backend telemetry exists">
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-6 text-center">
                  <BarChart2 className="h-9 w-9 text-cyan-200/35" />
                  <p className="mt-4 text-sm font-semibold text-white">No event telemetry connected yet</p>
                  <p className="mt-1 max-w-md text-xs leading-5 text-[var(--omnix-text-3)]">
                    Query volume, token usage, department trends, and source retrieval charts will render here when the backend stores those events.
                  </p>
                </div>
              </StudioCard>

              <StudioCard title="Available Real Data" subtitle="Signals this board can use today">
                <div className="grid gap-2">
                  {Object.values(realMetrics).map((metric) => (
                    <div key={metric.label} className="flex items-center justify-between rounded-xl border border-[var(--omnix-border)] bg-black/15 px-3 py-2">
                      <span className="text-sm text-[var(--omnix-text-2)]">{metric.label}</span>
                      <span className="omnix-display text-sm font-semibold text-white">{metric.value}</span>
                    </div>
                  ))}
                </div>
              </StudioCard>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
