import { SettingsShell } from "@/components/settings/SettingsShell";
import { WorkspaceSettingsPanel } from "@/components/settings/WorkspaceSettingsPanel";
import { WorkspaceAccessPanel } from "@/components/workspace/WorkspaceAccessPanel";

export default function WorkspaceSettingsPage() {
  return (
    <SettingsShell
      title="Workspace Settings"
      description="Edit the active workspace identity and keep workspace-level controls separate from account profile settings."
    >
      <div className="space-y-6">
        <WorkspaceSettingsPanel />
        <WorkspaceAccessPanel />
      </div>
    </SettingsShell>
  );
}
