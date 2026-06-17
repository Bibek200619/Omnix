export function PageSkeleton() {
  return (
    <div className="omnix-page-frame animate-pulse" aria-hidden="true">
      <div className="mb-6 h-8 w-48 rounded-lg bg-white/5" />
      <div className="grid gap-4">
        {[...Array(3)].map((_, index) => (
          <div key={index} className="h-24 w-full rounded-xl border border-white/5 bg-white/[0.03]" />
        ))}
      </div>
    </div>
  );
}
