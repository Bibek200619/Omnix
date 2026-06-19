"use client";

import { useEffect, useState } from "react";
import { formatCalendarDate, formatRelativeTime } from "@/lib/time";

type ClientTimeProps = {
  value?: string | null;
  fallback?: string;
  format?: "relative" | "date";
};

export function ClientTime({
  value,
  fallback = "Recently",
  format = "relative",
}: ClientTimeProps) {
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    setLabel(format === "date" ? formatCalendarDate(value) : formatRelativeTime(value));
  }, [format, value]);

  return <>{label}</>;
}
