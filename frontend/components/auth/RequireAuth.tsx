"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { currentRouteRedirect } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";

type RequireAuthProps = {
  children: React.ReactNode;
};

export function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { authError, isConfigured, loading, session } = useAuth();

  useEffect(() => {
    if (isConfigured && !loading && !session) {
      router.replace(`/login?redirect=${encodeURIComponent(currentRouteRedirect())}`);
    }
  }, [isConfigured, loading, pathname, router, session]);

  if (!isConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 text-slate-300">
        <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-6 text-center shadow-soft">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-amber-300/30 bg-amber-300/10 text-amber-100">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="mt-5 text-xl font-semibold text-white">
            Authentication setup required
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">{authError}</p>
          <Link
            href="/"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.1]"
          >
            Return home
          </Link>
        </section>
      </main>
    );
  }

  if (loading || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
          Checking session...
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
