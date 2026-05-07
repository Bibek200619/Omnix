"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";

type Step = "idle" | "retrieving" | "analyzing" | "generating" | "finalizing" | "done" | "error";

export function ActionsMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string) {
    setOpen(true);
    setError(null);
    setResult(null);
    setStep("retrieving");

    try {
      // progress stages
      setTimeout(() => setStep("analyzing"), 250);
      const resp = await apiClient.post<{ status: string; steps: string[]; result: any }>("/actions/run", { action });
      setStep("generating");
      setResult(resp.result?.markdown ?? JSON.stringify(resp.result, null, 2));
      setStep("finalizing");
      setTimeout(() => setStep("done"), 300);
    } catch (err: any) {
      setError(err?.message || String(err));
      setStep("error");
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([result], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `omnix-action-result.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={className}>
      <Button type="button" variant="secondary" onClick={() => setOpen((o) => !o)}>
        Actions
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-[#071017] p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Workspace Actions</h3>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Close
                </Button>
                {result ? (
                  <Button type="button" variant="primary" onClick={download}>
                    Download
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button onClick={() => run("summarize")}>Summarize Workspace</Button>
              <Button onClick={() => run("tasks")}>Extract Action Items</Button>
              <Button onClick={() => run("compare")}>Compare Documents</Button>
              <Button onClick={() => run("faq")}>Generate FAQ</Button>
              <Button onClick={() => run("notes")}>Generate Notes</Button>
            </div>

            <div className="mt-4">
              <div className="text-sm text-slate-400">Status: {step}</div>
              {error ? <div className="mt-2 rounded border border-rose-400/20 bg-rose-400/10 p-2 text-sm text-rose-100">{error}</div> : null}

              {result ? (
                <div className="mt-3 max-h-80 overflow-auto rounded border border-white/6 bg-black/40 p-3 text-sm text-slate-200">
                  <pre className="whitespace-pre-wrap">{result}</pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
