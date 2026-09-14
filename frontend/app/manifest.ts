import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Omnix",
    short_name: "Omnix",
    description:
      "A collaborative AI research workspace for secure chat, live web intelligence, uploads, RAG, and team knowledge synthesis.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#061020",
    theme_color: "#061020",
    orientation: "portrait-primary",
    categories: ["productivity", "business", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
