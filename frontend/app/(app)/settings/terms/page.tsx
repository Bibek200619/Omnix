"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";

const terms = [
  "Omnix AI is currently a frontend-ready product surface with mocked interactions.",
  "Authentication, verification, and chat calls should be connected to Supabase and FastAPI before production use.",
  "Conversation data shown in this build is sample data only and should be replaced by authenticated API responses.",
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
            Placeholder terms for the Omnix AI frontend while backend
            integration is pending.
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {terms.map((term, index) => (
          <section
            key={term}
            className="rounded-lg border border-white/10 bg-black/20 p-4"
          >
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-cyan-200/70">
              Section {index + 1}
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-300">{term}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
