"use client";

import { createContext, useContext } from "react";
import type { WorkspaceTreeContextValue } from "./workspace-context-types";

export const WorkspaceTreeContext = createContext<WorkspaceTreeContextValue | undefined>(undefined);

export function useWorkspaceTree() {
  const ctx = useContext(WorkspaceTreeContext);
  if (!ctx) {
    throw new Error("useWorkspaceTree must be used within WorkspaceProvider");
  }
  return ctx;
}
