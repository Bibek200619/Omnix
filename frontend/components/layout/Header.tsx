"use client";

import { useState } from "react";
import { AlertCircle, Menu, MessageSquarePlus, LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";

const routeTitles = [
  { match: "/chat", title: "Chat", eyebrow: "AI workspace" },
  { match: "/history", title: "History", eyebrow: "Previous conversations" },
  { match: "/settings/terms", title: "Terms", eyebrow: "Product policies" },
  { match: "/settings", title: "Settings", eyebrow: "Account controls" },
];

type HeaderProps = {
  onMenuClick: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const active =
    routeTitles.find((route) => pathname.startsWith(route.match)) ??
    routeTitles[0];

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);

    const { error } = await signOut();

    if (error) {
      console.error("Unable to sign out", error);
      setSignOutError(error.message || "Unable to sign out.");
      setSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            title="Open navigation"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-200/70">
              {active.eyebrow}
            </p>
            <h1 className="truncate text-lg font-semibold text-white sm:text-xl">
              {active.title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            leftIcon={<MessageSquarePlus className="h-4 w-4" />}
            onClick={() => router.push("/chat")}
            className="hidden sm:inline-flex"
          >
            New chat
          </Button>
          <Button
            type="button"
            variant="ghost"
            leftIcon={<LogOut className="h-4 w-4" />}
            isLoading={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out" : "Sign out"}
          </Button>
        </div>
      </div>
      {signOutError ? (
        <div className="border-t border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {signOutError}
          </div>
        </div>
      ) : null}
    </header>
  );
}
