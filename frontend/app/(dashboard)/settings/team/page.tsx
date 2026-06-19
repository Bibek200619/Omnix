import { SettingsShell } from "@/components/settings/SettingsShell";
import { WorkspaceAccessPanel } from "@/components/workspace/WorkspaceAccessPanel";

export default function TeamSettingsPage() {
  return (
    <SettingsShell
      title="Team Management"
      description="Review workspace membership, roles, and invite activity without mixing account-level profile settings."
    >
      <WorkspaceAccessPanel />
    </SettingsShell>
  );
}
