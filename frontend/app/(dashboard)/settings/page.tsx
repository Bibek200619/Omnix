import { AccountProfileSettings } from "@/components/settings/AccountProfileSettings";
import { SettingsShell } from "@/components/settings/SettingsShell";

export default function SettingsIndexPage() {
  return (
    <SettingsShell
      title="Profile"
      description="Manage the identity teammates see across Omnix: avatar, display name, handle, and email."
    >
      <AccountProfileSettings />
    </SettingsShell>
  );
}
