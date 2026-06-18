"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  ClipboardCheck,
  Compass,
  Loader2,
  MessagesSquare,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceSearchResponse, WorkspaceSearchResult } from "@/lib/workspace-types";

type GroupKey = keyof WorkspaceSearchResponse;

const groups: Array<{ key: GroupKey; label: string; icon: LucideIcon }> = [
  { key: "tasks", label: "Tasks", icon: ClipboardCheck },
  { key: "decisions", label: "Decisions", icon: BadgeCheck },
  { key: "initiatives", label: "Initiatives", icon: Compass },
  { key: "conversations", label: "Conversations", icon: MessagesSquare },
];

const emptyResults: WorkspaceSearchResponse = {
  conversations: [],
  tasks: [],
  initiatives: [],
  decisions: [],
};

function resultTypeLabel(result: WorkspaceSearchResult) {
  if (result.type === "conversation") return "Conversation";
  if (result.type === "initiative") return "Initiative";
  if (result.type === "decision") return "Decision";
  return "Task";
}

export function WorkspaceSearch() {
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResponse>(emptyResults);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const desktopInputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);

  const trimmedQuery = query.trim();
  const flatResults = useMemo(
    () => groups.flatMap((group) => results[group.key]),
    [results],
  );
  const hasResults = flatResults.length > 0;
  const totalResults = flatResults.length;
  const disabled = !activeWorkspaceId;

  useEffect(() => {
    setQuery("");
    setResults(emptyResults);
    setError(null);
    setOpen(false);
  }, [activeWorkspaceId]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setActiveIndex(0);

    if (!activeWorkspaceId || !trimmedQuery) {
      setResults(emptyResults);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      apiClient
        .searchWorkspace(activeWorkspaceId, trimmedQuery)
        .then((incoming) => {
          if (requestId !== requestRef.current) return;
          setResults(incoming);
        })
        .catch((err) => {
          if (requestId !== requestRef.current) return;
          logClientError("Failed to search workspace", err, {
            endpoint: `/workspaces/${activeWorkspaceId}/search`,
          });
          setResults(emptyResults);
          setError("Workspace search is temporarily unavailable. Please try again in a moment.");
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [activeWorkspaceId, trimmedQuery]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      if (window.matchMedia("(max-width: 767px)").matches) {
        mobileInputRef.current?.focus();
      }
    }, 0);
  }, [open]);

  function openSearch() {
    if (disabled) return;
    setOpen(true);
  }

  function closeSearch() {
    setOpen(false);
    desktopInputRef.current?.blur();
  }

  function clearSearch() {
    setQuery("");
    setResults(emptyResults);
    setError(null);
    setActiveIndex(0);
  }

  function navigateToResult(result: WorkspaceSearchResult) {
    setOpen(false);
    router.push(result.url);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (flatResults.length) {
        setActiveIndex((current) => (current + 1) % flatResults.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (flatResults.length) {
        setActiveIndex((current) => (current - 1 + flatResults.length) % flatResults.length);
      }
      return;
    }
    if (event.key === "Enter") {
      const result = flatResults[activeIndex] ?? flatResults[0];
      if (result) {
        event.preventDefault();
        navigateToResult(result);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  }

  const inputProps = {
    value: query,
    disabled,
    placeholder: "Search Omnix...",
    onFocus: openSearch,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value.slice(0, 120));
      setOpen(true);
    },
    onKeyDown: handleInputKeyDown,
  };

  return (
    <div ref={rootRef} className="relative z-40 flex min-w-0 shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={openSearch}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--omnix-rgba-0-255-255-0-1)] bg-[var(--omnix-rgba-0-255-255-0-04)] text-[var(--omnix-text-2)] transition hover:border-[var(--omnix-rgba-0-255-255-0-3)] hover:bg-[var(--omnix-rgba-0-255-255-0-08)] active:scale-[0.97] disabled:opacity-40 md:hidden"
        aria-label="Search Omnix"
        title="Search Omnix"
      >
        <Search className="h-4 w-4" />
      </button>

      <div className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-100/35" />
        <input
          ref={desktopInputRef}
          {...inputProps}
          className="h-9 w-[17rem] rounded-[10px] border border-cyan-300/10 bg-black/20 pl-9 pr-8 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/35 focus:bg-black/35 focus:shadow-[var(--omnix-glow-xs)] lg:w-[22rem] xl:w-[28rem]"
        />
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-100/45" />
        ) : query ? (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-white/35 hover:bg-white/5 hover:text-white/70"
            aria-label="Clear workspace search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[min(86dvh,42rem)] overflow-hidden rounded-t-2xl border border-cyan-300/15 bg-[var(--omnix-rgba-3-8-18-0-96)] shadow-[0_-24px_80px_var(--omnix-rgba-0-0-0-0-55),var(--omnix-glow-sm)] backdrop-blur-2xl md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-[calc(100%+0.6rem)] md:w-[min(34rem,calc(100vw-2rem))] md:max-h-[min(34rem,calc(100dvh-8rem))] md:rounded-2xl">
          <div className="border-b border-white/5 p-2 md:hidden">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" />
            <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-100/35" />
              <input
                ref={mobileInputRef}
                {...inputProps}
                className="h-11 w-full rounded-xl border border-cyan-300/12 bg-black/25 pl-9 pr-9 text-base text-white outline-none placeholder:text-white/25 focus:border-cyan-300/35"
              />
              {loading ? (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-100/45" />
              ) : query ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-white/35 hover:bg-white/5 hover:text-white/70"
                  aria-label="Clear workspace search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeSearch}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-white/55"
              aria-label="Close workspace search"
            >
              <X className="h-4 w-4" />
            </button>
            </div>
          </div>

          <div className="omnix-scrollbar max-h-[calc(100dvh-6.8rem)] overflow-y-auto p-2 md:max-h-[min(31rem,calc(100dvh-10rem))]">
            {!trimmedQuery ? (
              <div className="px-3 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/45">Workspace search</p>
                <div className="mt-3 grid gap-2 text-sm text-[var(--omnix-text-2)]">
                  <div className="rounded-xl border border-[var(--omnix-border)] bg-white/[0.025] p-3">
                    Search tasks, decisions, initiatives, and conversations inside the active workspace.
                  </div>
                  <div className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3 text-xs leading-5 text-[var(--omnix-text-3)]">
                    Start with a title, owner phrase, decision reason, or message keyword.
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="px-3 py-5 text-sm text-rose-100">{error}</div>
            ) : loading && !hasResults ? (
              <div className="flex items-center gap-2 px-3 py-5 text-sm text-[var(--omnix-text-2)]">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-100/50" />
                Searching workspace
              </div>
            ) : !hasResults ? (
              <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/10 px-3 py-5 text-sm text-[var(--omnix-text-2)]">
                <p className="font-medium text-white">No matching workspace information found.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">
                  Try a shorter phrase or search by source type, owner, status, or channel name.
                </p>
                <button
                  type="button"
                  onClick={clearSearch}
                  className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-xs font-medium text-cyan-100/85"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 px-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/45">
                    Results
                  </p>
                  <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-white/45">
                    {totalResults} found
                  </span>
                </div>
                {groups.map((group) => {
                  const items = results[group.key];
                  if (!items.length) return null;
                  const Icon = group.icon;
                  return (
                    <section key={group.key}>
                      <div className="mb-1.5 flex items-center gap-2 px-2">
                        <Icon className="h-3.5 w-3.5 text-cyan-100/45" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/45">
                          {group.label} · {items.length}
                        </p>
                      </div>
                      <div className="space-y-1">
                        {items.map((result) => {
                          const index = flatResults.findIndex(
                            (item) => item.type === result.type && item.id === result.id,
                          );
                          const active = index === activeIndex;
                          return (
                            <button
                              key={`${result.type}-${result.id}-${result.message_id || "record"}`}
                              type="button"
                              onMouseEnter={() => setActiveIndex(Math.max(index, 0))}
                              onClick={() => navigateToResult(result)}
                              className={cn(
                                "group flex min-h-[3.75rem] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                                active
                                  ? "border-cyan-300/35 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-xs)]"
                                  : "border-transparent bg-white/[0.015] hover:border-cyan-300/18 hover:bg-white/[0.035]",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-white">{result.title}</p>
                                  <span className="shrink-0 rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
                                    {resultTypeLabel(result)}
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">
                                  {result.preview || result.context || "Workspace record"}
                                </p>
                              </div>
                              <ArrowUpRight className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-cyan-100/70" />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
