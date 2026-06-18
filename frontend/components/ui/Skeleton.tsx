import { cn } from "@/lib/utils";

type SkeletonProps = {
  className?: string;
  variant?: "line" | "circle" | "block";
};

const variantClasses: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  line: "h-3 rounded-full",
  circle: "aspect-square rounded-full",
  block: "rounded-lg",
};

export function Skeleton({ className, variant = "block" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("shimmer bg-white/[0.04]", variantClasses[variant], className)}
    />
  );
}
