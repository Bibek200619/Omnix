"use client";

import { useState } from "react";
import { BrainCircuit, CheckCircle2, Globe, Server, SlidersHorizontal, Zap } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Toggle } from "@/components/ui/Toggle";

const modes = [
  { id: "deep", name: "Deep Think", desc: "Complex reasoning and multi-step analysis", icon: BrainCircuit, color: "var(--omnix-purple)" },
  { id: "fast", name: "Fast", desc: "Quick responses and standard workspace logic", icon: Zap, color: "var(--omnix-cyan)" },
  { id: "balanced", name: "Balanced", desc: "Default speed and quality balance", icon: SlidersHorizontal, color: "var(--omnix-green)" },
];

export default function AISettingsPage() {
  const [mode, setMode] = useState("balanced");
  const [webSearch, setWebSearch] = useState(true);
  const [memory, setMemory] = useState(true);
  const [temperature, setTemperature] = useState(0.7);

  return (
    <SettingsShell
      title="AI Settings"
      description="Configure how Omnix reasons, uses context, and responds inside your workspace."
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="omnix-cinematic-card border-[var(--omnix-border-active)] bg-cyan-300/[0.04] p-5 shadow-[var(--omnix-glow-xs)]">
          <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
              <Server className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="omnix-display text-lg font-semibold text-white">Connected Model</h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100">
                  <CheckCircle2 className="h-3 w-3" />
                  Online
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--omnix-text-2)]">Backend model routing is preserved through the existing Omnix API.</p>
            </div>
          </div>
          <div className="relative z-10 mt-4 grid gap-3 sm:grid-cols-3">
            {["Provider: Omnix API", "Context: Workspace + Web", "Streaming: Enabled"].map((item) => (
              <div key={item} className="rounded-lg border border-[var(--omnix-border)] bg-black/20 px-3 py-2 text-xs text-[var(--omnix-text-2)]">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="omnix-cinematic-card p-5">
          <p className="relative z-10 mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Default Mode</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {modes.map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className="rounded-xl border p-4 text-left transition hover:-translate-y-0.5"
                  style={{
                    background: active ? `${item.color}12` : "var(--omnix-surface)",
                    borderColor: active ? `${item.color}66` : "var(--omnix-border)",
                    boxShadow: active ? `0 0 18px ${item.color}22` : "none",
                  }}
                >
                  <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--omnix-border)]" style={{ background: `${item.color}18` }}>
                    <Icon className="h-4 w-4" style={{ color: item.color }} />
                  </span>
                  <span className="block text-sm font-semibold text-white">{item.name}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--omnix-text-3)]">{item.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="omnix-cinematic-card overflow-hidden">
          <div className="relative z-10">
          <Toggle
            label="Web Search"
            description="Allow Omnix to request live web context when a conversation asks for current information."
            checked={webSearch}
            onChange={(event) => setWebSearch(event.target.checked)}
            className="rounded-none border-0 border-b border-[var(--omnix-border)] bg-transparent"
          />
          <Toggle
            label="Context Memory"
            description="Use workspace conversation history and uploaded files as retrieval context."
            checked={memory}
            onChange={(event) => setMemory(event.target.checked)}
            className="rounded-none border-0 border-b border-[var(--omnix-border)] bg-transparent"
          />
          <div className="p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <Globe className="h-4 w-4 text-[var(--omnix-green)]" />
                  Creativity / Temperature
                </div>
                <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Higher values make output more exploratory.</p>
              </div>
              <span className="rounded-md border border-[var(--omnix-border)] bg-black/25 px-2 py-1 font-mono text-xs text-cyan-100">
                {temperature.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="w-full accent-cyan-300"
            />
          </div>
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
