"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function TermsPage() {
  const router = useRouter();

  return (
    <article className="mx-auto max-w-4xl rounded-lg border border-white/10 bg-white/[0.045] p-5 sm:p-8">
      <Button variant="ghost" onClick={() => router.push("/settings")} className="mb-6">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to settings
      </Button>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-200/80">Terms</p>
      <h2 className="mt-3 text-3xl font-semibold text-white">Terms of service</h2>
      <div className="mt-6 space-y-5 text-sm leading-7 text-stone-400">
        <p>
          Omnix AI is prepared as a frontend application shell. Authentication, chat retrieval, and persistence
          should be connected to your production backend before handling real customer data.
        </p>
        <p>
          AI responses should be reviewed for accuracy, especially when connected to private documents or sensitive
          operational workflows.
        </p>
        <p>
          This page is intentionally lightweight so it can be replaced with your legal copy without changing the app
          navigation.
        </p>
      </div>
    </article>
  );
}
