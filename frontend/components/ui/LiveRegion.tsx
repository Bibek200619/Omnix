import { cn } from "@/lib/utils";

type LiveRegionProps = {
  message: string;
  politeness?: "polite" | "assertive";
  className?: string;
};

export function LiveRegion({
  message,
  politeness = "polite",
  className,
}: LiveRegionProps) {
  return (
    <p
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
      className={cn("sr-only", className)}
    >
      {message}
    </p>
  );
}
