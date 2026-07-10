"use client";

import { useMemo } from "react";

type CommandPaletteAnnouncementParams = {
  open: boolean;
  query: string;
  loading: boolean;
  error: string | null;
  quickActionCount: number;
  searchResultCount: number;
  recentCount: number;
};

function itemLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatParts(parts: string[]) {
  return parts.filter(Boolean).join(", ");
}

export function useCommandPaletteAnnouncement({
  open,
  query,
  loading,
  error,
  quickActionCount,
  searchResultCount,
  recentCount,
}: CommandPaletteAnnouncementParams) {
  return useMemo(() => {
    if (!open) {
      return "";
    }

    if (error) {
      return error;
    }

    const visibleResultCount = quickActionCount + searchResultCount + recentCount;

    if (loading) {
      const currentResults = visibleResultCount
        ? ` ${itemLabel(visibleResultCount, "current result", "current results")} shown.`
        : "";
      return `Searching workspace…${currentResults}`;
    }

    if (query) {
      if (!visibleResultCount) {
        return `No command or workspace results for "${query}".`;
      }

      const parts = formatParts([
        quickActionCount ? itemLabel(quickActionCount, "quick action", "quick actions") : "",
        searchResultCount ? itemLabel(searchResultCount, "workspace result", "workspace results") : "",
        recentCount ? itemLabel(recentCount, "recent destination", "recent destinations") : "",
      ]);
      return `${itemLabel(visibleResultCount, "result", "results")} available for "${query}". ${parts}.`;
    }

    return `${itemLabel(visibleResultCount, "command", "commands")} available.`;
  }, [
    error,
    loading,
    open,
    query,
    quickActionCount,
    recentCount,
    searchResultCount,
  ]);
}
