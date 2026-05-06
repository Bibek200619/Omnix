"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";

const terms = [
  {
    title: "Account Access",
    copy: "You are responsible for keeping your Omnix credentials secure. Authentication is handled by Supabase, and active sessions can be revoked by signing out.",
  },
  {
    title: "Workspace Data",
    copy: "Questions, responses, and conversation metadata are associated with the signed-in account. The frontend only sends authenticated requests to the configured Omnix API.",
  },
  {
    title: "AI Responses",
    copy: "Generated answers should be reviewed before use in sensitive workflows. Source-backed retrieval and backend safeguards remain part of the production integration.",
  },
  {
    title: "Acceptable Use",
    copy: "Do not submit content that violates law, infringes rights, or attempts to bypass platform security controls.",
  },
];

export default function TermsPage() {
  const router = useRouter();

  return (
    <article className="mx-auto max-w-3xl rounded-lg border border-white/10 bg-white/[0.04] p-5 sm:p-7">
      <Button
        type="button"
        variant="ghost"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => router.push("/settings")}
      >
        Back to settings
      </Button>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Terms
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Terms for the Omnix AI authenticated workspace.
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {terms.map((term, index) => (
          <section
            key={term.title}
            className="rounded-lg border border-white/10 bg-black/20 p-4"
          >
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-cyan-200/70">
              Section {index + 1}
            </p>
            <h3 className="mt-3 font-semibold text-white">{term.title}</h3>
            <p className="mt-2 text-sm leading-7 text-slate-300">{term.copy}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
