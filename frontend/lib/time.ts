type RelativeTimeOptions = {
  fallback?: string;
  includeAgo?: boolean;
  localeAfterDays?: number | false;
  rounding?: "floor" | "round";
};

export function formatRelativeTime(value?: string | null, options: RelativeTimeOptions = {}) {
  const fallback = options.fallback ?? "Recently";
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const includeAgo = options.includeAgo ?? false;
  const localeAfterDays = options.localeAfterDays ?? 7;
  const suffix = includeAgo ? " ago" : "";
  const diffMs = Date.now() - date.getTime();
  const minutes =
    options.rounding === "round"
      ? Math.max(0, Math.round(diffMs / 60000))
      : Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m${suffix}`;

  const hours =
    options.rounding === "round"
      ? Math.round(minutes / 60)
      : Math.floor(diffMs / 3600000);
  if (hours < 24) return `${hours}h${suffix}`;

  const days =
    options.rounding === "round"
      ? Math.round(hours / 24)
      : Math.floor(diffMs / 86400000);

  if (localeAfterDays !== false && days >= localeAfterDays) {
    return date.toLocaleDateString();
  }

  return `${days}d${suffix}`;
}

export function formatCalendarDate(value?: string | null) {
  return formatRelativeTime(value, { includeAgo: true });
}
