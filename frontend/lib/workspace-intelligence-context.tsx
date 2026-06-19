"use client";

import { createContext, useContext } from "react";
import type { WorkspaceIntelligenceContextValue } from "./workspace-context-types";

export const WorkspaceIntelligenceContext = createContext<WorkspaceIntelligenceContextValue | undefined>(undefined);

export function useWorkspaceIntelligence() {
  const ctx = useContext(WorkspaceIntelligenceContext);
  if (!ctx) {
    throw new Error("useWorkspaceIntelligence must be used within WorkspaceProvider");
  }
  return ctx;
}
