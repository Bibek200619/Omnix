import { cn } from "@/lib/utils";

type ExecutionOverviewItem = {
  label: string;
  count: number;
  color: string;
};

type ExecutionOverviewProps = {
  items: ExecutionOverviewItem[] | null;
};

export function ExecutionOverview({ items }: ExecutionOverviewProps) {
  if (!items) return null;

  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3 shadow-[var(--omnix-glow-xs)] transition hover:bg-white/[0.02]"
        >
          <p className={cn("text-xl font-bold sm:text-2xl", item.color)}>{item.count}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}
