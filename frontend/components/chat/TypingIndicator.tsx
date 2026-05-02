"use client";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-3">
      {[0, 1, 2].map((item) => (
        <span
          key={item}
          className="h-2 w-2 animate-bounce rounded-full bg-cyan-200"
          style={{ animationDelay: `${item * 110}ms` }}
        />
      ))}
    </div>
  );
}
