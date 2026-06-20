const ABSOLUTE_PROTOCOL_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

function normalizedInput(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function safeExternalUrl(value?: string | null): string | null {
  const trimmed = normalizedInput(value);
  if (!trimmed || !ABSOLUTE_PROTOCOL_RE.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function safeLinkHref(value?: string | null): string | null {
  const trimmed = normalizedInput(value);
  if (!trimmed) return null;

  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;

  return safeExternalUrl(trimmed);
}
