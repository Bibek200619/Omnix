import { SettingsShell } from "@/components/settings/SettingsShell";
import { WorkspaceSettingsPanel } from "@/components/settings/WorkspaceSettingsPanel";

export default function WorkspaceSettingsPage() {
  return (
    <SettingsShell
      title="Workspace Settings"
      description="Edit the active workspace identity and keep workspace-level controls separate from account profile settings."
    >
      <WorkspaceSettingsPanel />
    </SettingsShell>
  );
}
