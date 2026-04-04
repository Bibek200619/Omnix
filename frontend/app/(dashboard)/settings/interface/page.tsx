"use client";

import { useEffect, useState } from "react";
import { LayoutPanelTop, Monitor } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Toggle } from "@/components/ui/Toggle";

export default function InterfaceSettingsPage() {
  const [compactMode, setCompactMode] = useState(false);

  useEffect(() => {
    setCompactMode(window.localStorage.getItem("omnix.compactMode") === "true");
  }, []);

  function updateCompact(value: boolean) {
    setCompactMode(value);
    window.localStorage.setItem("omnix.compactMode", String(value));
  }

  return (
    <SettingsShell
      title="Interface / Preferences"
      description="Local presentation and density controls for this browser."
    >
      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
        <div className="flex items-center gap-3">
          <Monitor className="h-5 w-5 text-cyan-200" />
          <h3 className="font-semibold text-white">Display preferences</h3>
        </div>
        <div className="mt-5 grid gap-3">
          <Toggle
            label="Compact conversation list"
            description="Use denser history rows in the sidebar."
            checked={compactMode}
            onChange={(event) => updateCompact(event.target.checked)}
          />
        </div>
        <div className="mt-5 rounded-lg border border-white/10 bg-black/15 p-4 text-sm leading-6 text-slate-400">
          <LayoutPanelTop className="mr-2 inline h-4 w-4 text-amber-200" />
          Sidebar collapse preferences are saved automatically from the sidebar control.
        </div>
      </section>
    </SettingsShell>
  );
}
