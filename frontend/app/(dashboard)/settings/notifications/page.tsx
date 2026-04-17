"use client";

import { useEffect, useState } from "react";
import { Bell, Mail } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Toggle } from "@/components/ui/Toggle";

export default function NotificationSettingsPage() {
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [inviteAlerts, setInviteAlerts] = useState(true);

  useEffect(() => {
    setEmailUpdates(window.localStorage.getItem("omnix.emailUpdates") !== "false");
    setInviteAlerts(window.localStorage.getItem("omnix.inviteAlerts") !== "false");
  }, []);

  function updateEmail(value: boolean) {
    setEmailUpdates(value);
    window.localStorage.setItem("omnix.emailUpdates", String(value));
  }

  function updateInvites(value: boolean) {
    setInviteAlerts(value);
    window.localStorage.setItem("omnix.inviteAlerts", String(value));
  }

  return (
    <SettingsShell
      title="Notifications"
      description="Keep invite and workspace alerts visible without burying them in account details."
    >
      <div className="grid gap-4">
        <section className="omnix-cinematic-card p-5">
          <div className="relative z-10 flex items-center gap-3">
            <Bell className="h-5 w-5 text-cyan-200" />
            <h3 className="font-semibold text-white">Workspace alerts</h3>
          </div>
          <div className="relative z-10 mt-5 grid gap-3">
            <Toggle
              label="Invite notifications"
              description="Show top-bar and sidebar notifications for pending workspace invites."
              checked={inviteAlerts}
              onChange={(event) => updateInvites(event.target.checked)}
            />
            <Toggle
              label="Workspace emails"
              description="Receive product and workspace activity updates when email delivery is configured."
              checked={emailUpdates}
              onChange={(event) => updateEmail(event.target.checked)}
            />
          </div>
        </section>
        <section className="omnix-cinematic-card p-5">
          <div className="relative z-10 flex items-center gap-3 text-sm text-[var(--omnix-text-2)]">
            <Mail className="h-4 w-4 text-amber-200" />
            Email invitations are sent from the backend when a workspace invite is created.
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
