"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Bell,
  ClipboardCheck,
  Command,
  Compass,
  FileText,
  Loader2,
  MessagesSquare,
  Plus,
  Search,
  Settings,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Portal } from "@/components/ui/Portal";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceSearchResponse, WorkspaceSearchResult } from "@/lib/workspace-types";

type SearchGroupKey = keyof WorkspaceSearchResponse;
type PaletteItemKind = "action" | "search" | "recent";

type PaletteItem = {
  id: string;
  kind: PaletteItemKind;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  group?: SearchGroupKey;
  createType?: "task" | "decision" | "initiative";
};

type RecentDestination = {
  href: string;
  label: string;
  description: string;
  visitedAt: number;
};

const searchGroups: Array<{ key: SearchGroupKey; label: string; icon: LucideIcon }> = [
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

const quickActions: PaletteItem[] = [
  {
    id: "action:create-task",
    kind: "action",
    label: "Create Task",
    description: "Open the existing task creation flow.",
    href: "/tasks?create=task",
    icon: Plus,
    createType: "task",
  },
  {
    id: "action:create-decision",
    kind: "action",
    label: "Create Decision",
    description: "Open the existing decision creation flow.",
    href: "/decisions?create=decision",
    icon: Plus,
    createType: "decision",
  },
  {
    id: "action:create-initiative",
    kind: "action",
    label: "Create Initiative",
    description: "Open the existing initiative creation flow.",
    href: "/initiatives?create=initiative",
    icon: Plus,
    createType: "initiative",
  },
  {
    id: "action:open-conversations",
    kind: "action",
    label: "Open Conversations",
    description: "Go to workspace conversations.",
    href: "/conversations",
    icon: MessagesSquare,
  },
  {
    id: "action:open-tasks",
    kind: "action",
    label: "Open Tasks",
    description: "Go to shared execution.",
    href: "/tasks",
    icon: ClipboardCheck,
  },
  {
    id: "action:open-decisions",
    kind: "action",
    label: "Open Decisions",
    description: "Go to decision memory.",
    href: "/decisions",
    icon: BadgeCheck,
  },
  {
    id: "action:open-initiatives",
    kind: "action",
    label: "Open Initiatives",
    description: "Go to shared operational direction.",
    href: "/initiatives",
    icon: Compass,
  },
  {
    id: "action:open-notifications",
    kind: "action",
    label: "Open Notifications",
    description: "Go to mention notifications.",
    href: "/notifications",
    icon: Bell,
  },
  {
    id: "action:open-team",
    kind: "action",
    label: "Open Team",
    description: "Go to workspace members.",
    href: "/team",
    icon: UsersRound,
  },
  {
    id: "action:open-files",
    kind: "action",
    label: "Open Files",
    description: "Go to workspace files.",
    href: "/files",
    icon: FileText,
  },
  {
    id: "action:open-settings",
    kind: "action",
    label: "Open Settings",
    description: "Go to workspace settings.",
    href: "/settings",
    icon: Settings,
  },
];

const destinations: Record<string, Omit<RecentDestination, "visitedAt">> = {
  "/dashboard": { href: "/dashboard", label: "Dashboard", description: "Workspace overview" },
  "/conversations": { href: "/conversations", label: "Conversations", description: "Operational discussion" },
  "/tasks": { href: "/tasks", label: "Tasks", description: "Shared execution" },
  "/decisions": { href: "/decisions", label: "Decisions", description: "Decision memory" },
  "/initiatives": { href: "/initiatives", label: "Initiatives", description: "Operational direction" },
  "/notifications": { href: "/notifications", label: "Notifications", description: "Mention notifications" },
  "/team": { href: "/team", label: "Team", description: "Workspace members" },
  "/files": { href: "/files", label: "Files", description: "Workspace files" },
  "/sources": { href: "/sources", label: "Sources", description: "Knowledge sources" },
  "/settings": { href: "/settings", label: "Settings", description: "Account and workspace controls" },
  "/workspace": { href: "/workspace", label: "Workspaces", description: "Workspace hierarchy" },
};

function recentStorageKey(workspaceId: string | null | undefined) {
  return `omnix.commandPalette.recent.${workspaceId || "global"}`;
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function matchesQuery(item: Pick<PaletteItem, "label" | "description">, query: string) {
  const value = normalize(query);
  if (!value) return true;
  return `${item.label} ${item.description}`.toLowerCase().includes(value);
}

function searchResultTypeLabel(result: WorkspaceSearchResult) {
  if (result.type === "conversation") return "Conversation";
  if (result.type === "initiative") return "Initiative";
  if (result.type === "decision") return "Decision";
  return "Task";
}

function searchResultIcon(result: WorkspaceSearchResult): LucideIcon {
  if (result.type === "conversation") return MessagesSquare;
  if (result.type === "initiative") return Compass;
  if (result.type === "decision") return BadgeCheck;
  return ClipboardCheck;
}

function searchResultItem(result: WorkspaceSearchResult, group: SearchGroupKey): PaletteItem {
  return {
    id: `search:${result.type}:${result.id}:${result.message_id || "record"}`,
    kind: "search",
    label: result.title,
    description: result.preview || result.context || searchResultTypeLabel(result),
    href: result.url,
    icon: searchResultIcon(result),
    group,
  };
}

function shortcutLabel() {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)) {
    return "⌘K";
  }
  return "Ctrl K";
}

function hrefWithFreshCreateToken(item: PaletteItem) {
  if (!item.createType) return item.href;
  const separator = item.href.includes("?") ? "&" : "?";
  return `${item.href}${separator}palette=${Date.now()}`;
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const [commandShortcut, setCommandShortcut] = useState("Ctrl K");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResponse>(emptyResults);
  const [recent, setRecent] = useState<RecentDestination[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const requestRef = useRef(0);
  const trimmedQuery = query.trim();

  const filteredActions = useMemo(
    () => quickActions.filter((item) => matchesQuery(item, trimmedQuery)).slice(0, trimmedQuery ? 5 : quickActions.length),
    [trimmedQuery],
  );

  const recentItems = useMemo<PaletteItem[]>(
    () =>
      recent
        .filter((item) => matchesQuery(item, trimmedQuery))
        .slice(0, 5)
        .map((item) => ({
          id: `recent:${item.href}`,
          kind: "recent",
          label: item.label,
          description: item.description,
          href: item.href,
          icon: ArrowUpRight,
        })),
    [recent, trimmedQuery],
  );

  const searchItemsByGroup = useMemo(
    () =>
      searchGroups.reduce<Record<SearchGroupKey, PaletteItem[]>>(
        (acc, group) => {
          acc[group.key] = results[group.key].map((result) => searchResultItem(result, group.key));
          return acc;
        },
        { conversations: [], tasks: [], initiatives: [], decisions: [] },
      ),
    [results],
  );

  const flatItems = useMemo(
    () => [
      ...filteredActions,
      ...searchGroups.flatMap((group) => searchItemsByGroup[group.key]),
      ...recentItems,
    ],
    [filteredActions, recentItems, searchItemsByGroup],
  );

  const hasSearchResults = searchGroups.some((group) => searchItemsByGroup[group.key].length > 0);

  useEffect(() => {
    setCommandShortcut(shortcutLabel());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        setQuery("");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    setQuery("");
    setResults(emptyResults);
    setError(null);
    setActiveIndex(0);
    try {
      const stored = window.localStorage.getItem(recentStorageKey(activeWorkspaceId));
      setRecent(stored ? (JSON.parse(stored) as RecentDestination[]) : []);
    } catch {
      setRecent([]);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const destination = destinations[pathname];
    if (!destination) return;
    try {
      const key = recentStorageKey(activeWorkspaceId);
      const stored = window.localStorage.getItem(key);
      const existing = stored ? (JSON.parse(stored) as RecentDestination[]) : [];
      const next = [
        { ...destination, visitedAt: Date.now() },
        ...existing.filter((item) => item.href !== destination.href),
      ].slice(0, 5);
      window.localStorage.setItem(key, JSON.stringify(next));
      setRecent(next);
    } catch {
      // Recent destinations are a local convenience only.
    }
  }, [activeWorkspaceId, pathname]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setActiveIndex(0);
    if (!open || !activeWorkspaceId || !trimmedQuery) {
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
          logClientError("Failed to search workspace from command palette", err, {
            endpoint: `/workspaces/${activeWorkspaceId}/search`,
          });
          setResults(emptyResults);
          setError("Workspace search is unavailable.");
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [activeWorkspaceId, open, trimmedQuery]);

  useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(Math.max(flatItems.length - 1, 0));
    }
  }, [activeIndex, flatItems.length]);

  useEffect(() => {
    if (!open) return;
    const item = flatItems[activeIndex];
    if (!item) return;
    itemRefs.current[item.id]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatItems, open]);

  function closePalette() {
    setOpen(false);
  }

  function selectItem(item: PaletteItem | undefined) {
    if (!item) return;
    closePalette();
    router.push(hrefWithFreshCreateToken(item));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Tab") {
      event.preventDefault();
      if (!flatItems.length) return;
      setActiveIndex((current) =>
        event.shiftKey ? (current - 1 + flatItems.length) % flatItems.length : (current + 1) % flatItems.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!flatItems.length) return;
      setActiveIndex((current) => (current - 1 + flatItems.length) % flatItems.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectItem(flatItems[activeIndex]);
    }
  }

  function renderItem(item: PaletteItem, index: number) {
    const Icon = item.icon;
    const active = index === activeIndex;
    return (
      <button
        key={item.id}
        ref={(node) => {
          itemRefs.current[item.id] = node;
        }}
        type="button"
        tabIndex={-1}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectItem(item)}
        className={cn(
          "group flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:scale-[0.995] sm:min-h-[3.9rem] sm:py-2.5",
          active
            ? "border-cyan-300/35 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-xs)]"
            : "border-transparent bg-white/[0.018] hover:border-cyan-300/18 hover:bg-white/[0.04]",
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/10 bg-cyan-300/[0.045] text-cyan-100/70">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">{item.label}</span>
            {item.kind === "search" ? (
              <span className="shrink-0 rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
                Search
              </span>
            ) : null}
          </span>
          <span className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">
            {item.description}
          </span>
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-cyan-100/70" />
      </button>
    );
  }

  let itemIndex = 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.04)] text-[var(--omnix-text-2)] transition hover:border-[rgba(0,255,255,0.3)] hover:bg-[rgba(0,255,255,0.08)] active:scale-[0.97] md:hidden"
        aria-label="Open command palette"
        title="Open command palette"
      >
        <Command className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
        className="hidden h-9 w-[17rem] items-center gap-3 rounded-[10px] border border-cyan-300/10 bg-black/20 px-3 text-left text-sm text-white/45 transition hover:border-cyan-300/25 hover:bg-black/30 hover:text-white/65 md:inline-flex lg:w-[22rem] xl:w-[28rem]"
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4 shrink-0 text-cyan-100/35" />
        <span className="min-w-0 flex-1 truncate">Search Omnix or run a command...</span>
        <kbd className="shrink-0 rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-white/35">
          {commandShortcut}
        </kbd>
      </button>

      {open ? (
        <Portal>
          <div
            className="fixed inset-0 z-[80] bg-black/35 backdrop-blur-[2px]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closePalette();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Omnix command palette"
              onKeyDown={handleKeyDown}
              className="fixed inset-x-0 bottom-0 flex max-h-[min(86dvh,44rem)] flex-col overflow-hidden rounded-t-[20px] border border-cyan-300/15 bg-[rgba(3,8,18,0.97)] shadow-[0_-24px_80px_rgba(0,0,0,0.55),var(--omnix-glow-sm)] backdrop-blur-2xl md:bottom-auto md:left-1/2 md:right-auto md:top-[12vh] md:max-h-[min(42rem,calc(100dvh-8rem))] md:w-[min(42rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-2xl"
            >
              <div className="border-b border-white/5 p-3 sm:p-4">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 md:hidden" />
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/45">
                      {activeWorkspace?.name || "Omnix"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--omnix-text-3)]">
                      Search, create, or jump without opening the sidebar
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closePalette}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white/80"
                    aria-label="Close command palette"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-100/35" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value.slice(0, 120))}
                    placeholder="Type a task, decision, page, or command..."
                    className="h-12 w-full rounded-xl border border-cyan-300/12 bg-black/25 pl-9 pr-11 text-base text-white outline-none placeholder:text-white/25 focus:border-cyan-300/35 focus:shadow-[var(--omnix-glow-xs)]"
                  />
                  {loading ? (
                    <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-100/45" />
                  ) : query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/35 hover:bg-white/5 hover:text-white/70"
                      aria-label="Clear command palette query"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="omnix-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-3">
                {filteredActions.length ? (
                  <section className="mb-4">
                    <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/45">
                      Quick Actions
                    </p>
                    <div className="space-y-1">
                      {filteredActions.map((item) => renderItem(item, itemIndex++))}
                    </div>
                  </section>
                ) : null}

                {trimmedQuery ? (
                  <section className="mb-4">
                    <div className="mb-1.5 flex items-center gap-2 px-2">
                      <Search className="h-3.5 w-3.5 text-cyan-100/45" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/45">
                        Workspace Search
                      </p>
                    </div>
                    {error ? (
                      <p className="px-2 py-3 text-sm text-rose-100">{error}</p>
                    ) : loading && !hasSearchResults ? (
                      <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--omnix-text-2)]">
                        <Loader2 className="h-4 w-4 animate-spin text-cyan-100/50" />
                        Searching workspace
                      </div>
                    ) : !hasSearchResults ? (
                      <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/10 px-3 py-4">
                        <p className="text-sm font-medium text-white">No command or workspace match.</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">
                          Try a task title, teammate term, decision phrase, or use a quick action below.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {searchGroups.map((group) => {
                          const items = searchItemsByGroup[group.key];
                          if (!items.length) return null;
                          const Icon = group.icon;
                          return (
                            <div key={group.key}>
                              <div className="mb-1 flex items-center gap-2 px-2">
                                <Icon className="h-3.5 w-3.5 text-cyan-100/40" />
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/40">
                                  {group.label}
                                </p>
                              </div>
                              <div className="space-y-1">
                                {items.map((item) => renderItem(item, itemIndex++))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : null}

                {recentItems.length ? (
                  <section>
                    <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/45">
                      Recent Destinations
                    </p>
                    <div className="space-y-1">
                      {recentItems.map((item) => renderItem(item, itemIndex++))}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}
