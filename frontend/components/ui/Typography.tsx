import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TypographyProps = {
  children: ReactNode;
  className?: string;
};

export function PageTitle({ children, className }: TypographyProps) {
  return <h1 className={cn("omnix-page-title omnix-display", className)}>{children}</h1>;
}

export function SectionTitle({ children, className }: TypographyProps) {
  return <h2 className={cn("omnix-display text-xl font-semibold text-white", className)}>{children}</h2>;
}

export function CardTitle({ children, className }: TypographyProps) {
  return <h3 className={cn("omnix-display text-sm font-bold text-white", className)}>{children}</h3>;
}

export function BodyText({ children, className }: TypographyProps) {
  return <p className={cn("text-sm leading-6 text-[var(--omnix-text)]", className)}>{children}</p>;
}

export function MutedText({ children, className }: TypographyProps) {
  return <p className={cn("text-sm leading-6 text-[var(--omnix-text-2)]", className)}>{children}</p>;
}
