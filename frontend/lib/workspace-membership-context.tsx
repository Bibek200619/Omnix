"use client";

import { createContext, useContext } from "react";
import type { WorkspaceMembershipContextValue } from "./workspace-context-types";

export const WorkspaceMembershipContext = createContext<WorkspaceMembershipContextValue | undefined>(undefined);

export function useWorkspaceMembership() {
  const ctx = useContext(WorkspaceMembershipContext);
  if (!ctx) {
    throw new Error("useWorkspaceMembership must be used within WorkspaceProvider");
  }
  return ctx;
}
