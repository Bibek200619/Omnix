export const DEFAULT_AUTH_REDIRECT = "/dashboard";

const AUTH_ROUTES = ["/login", "/register", "/auth/callback"];

export function safeRedirectPath(value?: string | null) {
  const fallback = DEFAULT_AUTH_REDIRECT;
  const candidate = (value || "").trim();

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "https://omnix.local");
    if (url.origin !== "https://omnix.local") {
      return fallback;
    }

    const path = `${url.pathname}${url.search}${url.hash}`;
    if (AUTH_ROUTES.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`))) {
      return fallback;
    }

    return path;
  } catch {
    return fallback;
  }
}

export function redirectFromWindow() {
  if (typeof window === "undefined") return DEFAULT_AUTH_REDIRECT;
  return safeRedirectPath(new URLSearchParams(window.location.search).get("redirect"));
}

export function authLink(path: string) {
  if (typeof window === "undefined") return path;
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  const safeRedirect = safeRedirectPath(redirect);

  if (!redirect || safeRedirect === DEFAULT_AUTH_REDIRECT) {
    return path;
  }

  return `${path}?redirect=${encodeURIComponent(safeRedirect)}`;
}

export function currentRouteRedirect() {
  if (typeof window === "undefined") return DEFAULT_AUTH_REDIRECT;
  return safeRedirectPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export function oauthCallbackUrl(nextPath?: string | null) {
  if (typeof window === "undefined") return "/auth/callback";

  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", safeRedirectPath(nextPath));
  return callbackUrl.toString();
}
