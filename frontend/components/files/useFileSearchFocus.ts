"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api";
import type {
  FileData,
  SourceSection,
  SourceType,
  WorkspaceConnector,
} from "@/components/files/filesPageModel";

type FileSearchFocusOptions = {
  files: FileData[];
  connectors: WorkspaceConnector[];
  activeSection: SourceSection;
  searchQuery: string;
  setActiveSection: Dispatch<SetStateAction<SourceSection>>;
  setActiveType: Dispatch<SetStateAction<SourceType>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
};

export function fileSearchFocusId(
  kind: "file" | "source",
  recordId: string,
) {
  return `omnix-search-${kind}-${encodeURIComponent(recordId)}`;
}

export async function loadFilesWithSearchTarget(
  focusedFileId: string | null,
) {
  const files = await apiClient.get<FileData[]>("/files");
  if (!focusedFileId || files.some((file) => file.id === focusedFileId)) {
    return files;
  }
  const target = await apiClient.get<FileData>(
    `/files/${encodeURIComponent(focusedFileId)}`,
  );
  return [target, ...files.filter((file) => file.id !== target.id)];
}

export function useFileSearchFocus({
  files,
  connectors,
  activeSection,
  searchQuery,
  setActiveSection,
  setActiveType,
  setSearchQuery,
}: FileSearchFocusOptions) {
  const searchParams = useSearchParams();
  const focusedFileId = searchParams?.get("id") ?? null;
  const focusedSourceId = searchParams?.get("source") ?? null;
  const preparedTokenRef = useRef<string | null>(null);
  const focusedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const focusedFile = focusedFileId
      ? files.find((file) => file.id === focusedFileId)
      : null;
    const focusedSource = focusedSourceId
      ? connectors.find((connector) => connector.id === focusedSourceId)
      : null;
    const token = focusedFile
      ? `file:${focusedFile.id}`
      : focusedSource
        ? `source:${focusedSource.id}`
        : null;
    if (!token || preparedTokenRef.current === token) return;
    preparedTokenRef.current = token;

    if (focusedFile) {
      setActiveSection("files");
      setActiveType("file");
      setSearchQuery(focusedFile.file_name ?? focusedFile.filename ?? "");
      return;
    }
    if (focusedSource) {
      setActiveSection("connectors");
      setActiveType(focusedSource.connector_type);
    }
  }, [
    connectors,
    files,
    focusedFileId,
    focusedSourceId,
    setActiveSection,
    setActiveType,
    setSearchQuery,
  ]);

  useEffect(() => {
    const target =
      activeSection === "files" && focusedFileId
        ? files.find((file) => file.id === focusedFileId)
        : activeSection === "connectors" && focusedSourceId
          ? connectors.find((connector) => connector.id === focusedSourceId)
          : null;
    const kind = activeSection === "files" ? "file" : "source";
    const token = target ? `${kind}:${target.id}` : null;
    if (!target || !token || focusedTokenRef.current === token) return;

    const frame = window.requestAnimationFrame(() => {
      const node = document.getElementById(fileSearchFocusId(kind, target.id));
      if (!node) return;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      node.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
      node.focus({ preventScroll: true });
      focusedTokenRef.current = token;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeSection,
    connectors,
    files,
    focusedFileId,
    focusedSourceId,
    searchQuery,
  ]);

  return { focusedFileId, focusedSourceId };
}
