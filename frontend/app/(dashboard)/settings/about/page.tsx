import Link from "next/link";
import { FileText, Sparkles } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";

export default function AboutSettingsPage() {
  return (
    <SettingsShell
      title="About / Terms"
      description="Product context, policies, and presentation-ready account responsibilities."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <Sparkles className="h-5 w-5 text-cyan-200" />
          <h3 className="mt-3 font-semibold text-white">Omnix</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            A collaborative AI workspace for team chat, document-aware reasoning, shared files, and workspace invites.
          </p>
        </section>
        <Link
          href="/settings/terms"
          className="rounded-lg border border-white/10 bg-white/[0.035] p-5 transition hover:border-cyan-300/30 hover:bg-white/[0.06]"
        >
          <FileText className="h-5 w-5 text-amber-200" />
          <h3 className="mt-3 font-semibold text-white">Terms and policies</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Review account access, workspace data, AI response guidance, and acceptable use.
          </p>
        </Link>
      </div>
    </SettingsShell>
  );
}
