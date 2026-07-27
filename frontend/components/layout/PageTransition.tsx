"use client";

import { cn } from "@/lib/utils";

type PageTransitionProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div className={cn("omnix-shell-page-enter min-h-0", className)}>
      {children}
    </div>
  );
}
