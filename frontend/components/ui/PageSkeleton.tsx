export function PageSkeleton() {
  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        Loading page…
      </p>
      <div className="omnix-page-frame" aria-hidden="true">
        <div className="omnix-content-max flex flex-col gap-6">
          <div className="relative overflow-hidden rounded-[28px] border border-white/5 bg-white/[0.03] p-7">
            <div className="shimmer absolute inset-0 opacity-20" />
            <div className="relative z-10 space-y-4">
              <div className="h-4 w-32 rounded-full bg-white/5" />
              <div className="h-10 w-64 rounded-xl bg-white/5" />
              <div className="h-4 w-full max-w-2xl rounded-full bg-white/5" />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-6">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-6">
                  <div className="shimmer absolute inset-0 opacity-10" />
                  <div className="relative z-10 flex gap-4">
                    <div className="h-12 w-12 rounded-xl bg-white/5" />
                    <div className="flex-1 space-y-3 pt-1">
                      <div className="h-4 w-1/3 rounded-full bg-white/5" />
                      <div className="h-3 w-full rounded-full bg-white/5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden space-y-6 lg:block">
              <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-6">
                <div className="shimmer absolute inset-0 opacity-10" />
                <div className="h-4 w-24 rounded-full bg-white/5 mb-6" />
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-10 w-full rounded-xl bg-white/5" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
