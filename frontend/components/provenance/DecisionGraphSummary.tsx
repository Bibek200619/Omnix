"use client";

import Link from "next/link";
import { BadgeCheck, CircleDot, ClipboardCheck, FileText, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type DecisionGraphNodeKind = "task" | "decision" | "evidence" | "source";

export type DecisionGraphNode = {
  kind: DecisionGraphNodeKind;
  title: string;
  detail?: string | null;
  href?: string;
};

type DecisionGraphSummaryProps = {
  title?: string;
  nodes: DecisionGraphNode[];
  compact?: boolean;
  className?: string;
};

const graphIcons = {
  task: ClipboardCheck,
  decision: BadgeCheck,
  evidence: FileText,
  source: MessagesSquare,
} satisfies Record<DecisionGraphNodeKind, typeof CircleDot>;

function nodeTone(kind: DecisionGraphNodeKind) {
  if (kind === "task") return "border-emerald-300/16 bg-emerald-300/[0.055] text-emerald-100";
  if (kind === "decision") return "border-cyan-300/18 bg-cyan-300/[0.07] text-cyan-100";
  if (kind === "evidence") return "border-amber-300/16 bg-amber-300/[0.055] text-amber-100";
  return "border-violet-300/16 bg-violet-300/[0.055] text-violet-100";
}

function GraphNode({ node }: { node: DecisionGraphNode }) {
  const Icon = graphIcons[node.kind];
  const content = (
    <>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", nodeTone(node.kind))}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-white">{node.title}</span>
        {node.detail ? <span className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">{node.detail}</span> : null}
      </span>
    </>
  );

  if (node.href) {
    return (
      <Link href={node.href} className="flex min-h-[4rem] items-start gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-2.5 transition hover:border-cyan-300/18 hover:bg-cyan-300/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55">
        {content}
      </Link>
    );
  }

  return <div className="flex min-h-[4rem] items-start gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-2.5">{content}</div>;
}

export function DecisionGraphSummary({
  title = "Decision graph",
  nodes,
  compact = false,
  className,
}: DecisionGraphSummaryProps) {
  return (
    <section className={cn("rounded-xl border border-[var(--omnix-border)] bg-white/[0.016] p-3", className)} aria-label="Decision traceability graph">
      <div className="mb-3 flex items-center gap-2">
        <CircleDot className="h-3.5 w-3.5 text-cyan-100/45" />
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">{title}</h4>
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "lg:grid-cols-4")}>
        {nodes.map((node, index) => (
          <div key={`${node.kind}-${index}-${node.title}`} className="relative">
            {index > 0 ? <span className="absolute -left-2 top-8 hidden h-px w-2 bg-cyan-300/20 lg:block" aria-hidden="true" /> : null}
            <GraphNode node={node} />
          </div>
        ))}
      </div>
    </section>
  );
}
