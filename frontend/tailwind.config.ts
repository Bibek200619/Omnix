import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#050c17",
        panel: "#0c0f14",
        line: "rgba(255,255,255,0.1)",
        muted: "#9ca3af",
        omnix: {
          bg: "#050c17",
          bg2: "#0a192f",
          bg3: "#0d2040",
          cyan: "#00ffff",
          blue: "#3366ff",
          red: "#ff3b5c",
          amber: "#ffb800",
          green: "#00e87a",
          purple: "#9b5cff",
          pink: "#ff4df4",
        },
      },
      boxShadow: {
        "omnix-glow-xs": "0 0 8px rgba(0,255,255,0.25)",
        "omnix-glow-sm": "0 0 16px rgba(0,255,255,0.3),0 0 32px rgba(0,255,255,0.08)",
        "omnix-glow-md": "0 0 24px rgba(0,255,255,0.35),0 0 60px rgba(0,255,255,0.12)",
        glow: "0 18px 70px rgba(34,211,238,0.14)",
        soft: "0 22px 80px rgba(0,0,0,0.35)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-space-grotesk)", "var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        omnix: "12px",
        "omnix-sm": "8px",
        "omnix-lg": "16px",
        "omnix-xl": "20px",
      },
      animation: {
        "omnix-fade-in": "omnix-fade-in 0.35s ease",
        "omnix-slide-in": "omnix-slide-in 0.42s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
