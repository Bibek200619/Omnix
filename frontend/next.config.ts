import type { NextConfig } from "next";

const DEFAULT_API_PROXY_TARGET =
  process.env.NODE_ENV === "development" ? "http://localhost:8000" : "https://api.omni-x.co.in";

function normalizeProxyTarget(value?: string | null) {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed.includes("REDACTED")) {
    return null;
  }
  return trimmed;
}

const apiProxyTarget =
  normalizeProxyTarget(process.env.OMNIX_API_PROXY_TARGET) ||
  normalizeProxyTarget(process.env.NEXT_PUBLIC_API_PROXY_TARGET) ||
  DEFAULT_API_PROXY_TARGET;

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/:path*`,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.supabase.com" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error"] }
        : false,
  },
};

export default nextConfig;
