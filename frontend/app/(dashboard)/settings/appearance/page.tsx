"use client";

import { useEffect, useState } from "react";
import { LayoutPanelTop, Monitor } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Toggle } from "@/components/ui/Toggle";

export default function AppearanceSettingsPage() {
  const [compactMode, setCompactMode] = useState(false);
  const [ambientMotion, setAmbientMotion] = useState(true);

  useEffect(() => {
    setCompactMode(window.localStorage.getItem("omnix.compactMode") === "true");
    setAmbientMotion(window.localStorage.getItem("omnix.ambientMotion") !== "false");
  }, []);

  function updateCompact(value: boolean) {
    setCompactMode(value);
    window.localStorage.setItem("omnix.compactMode", String(value));
  }

  function updateMotion(value: boolean) {
    setAmbientMotion(value);
    window.localStorage.setItem("omnix.ambientMotion", String(value));
  }

  return (
    <SettingsShell
      title="Appearance"
      description="Local presentation and density controls for this browser."
    >
      <section className="omnix-cinematic-card p-5">
        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
            <Monitor className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-white">Display preferences</h3>
            <p className="mt-1 text-sm text-[var(--omnix-text-2)]">Tune the cockpit without changing workspace data.</p>
          </div>
        </div>
        <div className="relative z-10 mt-5 grid gap-3">
          <Toggle
            label="Compact conversation list"
            description="Use denser history rows in the sidebar."
            checked={compactMode}
            onChange={(event) => updateCompact(event.target.checked)}
          />
          <Toggle
            label="Ambient motion"
            description="Keep subtle glows and motion enabled where supported."
            checked={ambientMotion}
            onChange={(event) => updateMotion(event.target.checked)}
          />
          <Toggle
            label="Adaptive themes"
            description="Dynamically adjust colors based on active workspace focus. Arriving in next rollout."
            checked={false}
            disabled
          />
        </div>
        <div className="relative z-10 mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)] mb-3">Theme engine in rollout — Preview only</div>
          <div className="grid gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/15 p-4 sm:grid-cols-3">
            {[
              ["Primary", "var(--omnix-cyan)"],
              ["Intelligence", "var(--omnix-blue-bright)"],
              ["Signal", "var(--omnix-green)"],
            ].map(([label, color]) => (
              <div key={label} className="flex items-center gap-2 text-sm text-[var(--omnix-text-2)]">
                <span className="h-5 w-5 rounded-md border border-[var(--omnix-border)] shadow-[var(--omnix-glow-xs)]" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 mt-5 rounded-lg border border-[var(--omnix-border)] bg-black/15 p-4 text-sm leading-6 text-[var(--omnix-text-2)]">
          <LayoutPanelTop className="mr-2 inline h-4 w-4 text-amber-200" />
          Sidebar collapse preferences are saved automatically from the sidebar control.
        </div>
      </section>
    </SettingsShell>
  );
}
