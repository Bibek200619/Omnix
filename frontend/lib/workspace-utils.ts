import type { Workspace } from "@/lib/workspace-types";

export function flattenWorkspaces(workspaces: Workspace[]) {
  const flattened: Workspace[] = [];

  function visit(workspace: Workspace) {
    flattened.push(workspace);
    workspace.subspaces?.forEach(visit);
  }

  workspaces.forEach(visit);
  return flattened;
}
