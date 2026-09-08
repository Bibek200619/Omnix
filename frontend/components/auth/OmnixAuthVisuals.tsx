"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { cn } from "@/lib/utils";

export const AUTH_C = {
  cyan: "var(--omnix-cyan)",
  blue: "var(--omnix-color-0033ff)",
  navy: "var(--omnix-bg-2)",
  navyDark: "var(--omnix-color-061020)",
  card: "var(--omnix-rgba-255-255-255-0-03)",
  border: "var(--omnix-rgba-255-255-255-0-08)",
  borderC: "var(--omnix-rgba-0-255-255-0-22)",
  white: "var(--omnix-color-ffffff)",
  muted: "var(--omnix-rgba-255-255-255-0-55)",
  faint: "var(--omnix-rgba-255-255-255-0-3)",
};

export const AUTH_ICONS = {
  check: "M5 13l4 4L19 7",
  arrow: "M5 12h14M12 5l7 7-7 7",
  user: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  mail: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  lock: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  phone: "M3 5.5A2.5 2.5 0 015.5 3h2A1.5 1.5 0 019 4.2l.55 2.2a1.5 1.5 0 01-.4 1.42l-1.1 1.1a12 12 0 005.03 5.03l1.1-1.1a1.5 1.5 0 011.42-.4l2.2.55A1.5 1.5 0 0119 14.5v2A2.5 2.5 0 0116.5 19h-.75A12.75 12.75 0 013 6.25V5.5z",
  workspace: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  upload: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
  team: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  sparkle: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  at: "M16 8.245v4.508a3.5 3.5 0 11-2.12-3.218M16 12.75a2.25 2.25 0 104.5 0V12a8.5 8.5 0 10-3.1 6.57",
};

export function AuthIcon({
  d,
  size = 18,
  stroke = AUTH_C.cyan,
  sw = 1.6,
}: {
  d: string;
  size?: number;
  stroke?: string;
  sw?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function AuthOmnixMark({ size = 36 }: { size?: number }) {
  return <OmnixMark size={size} />;
}

export function AuthBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="Omnix home">
      <AuthOmnixMark size={compact ? 32 : 34} />
      <span className="text-xl font-semibold tracking-[-0.045em] text-white">
        Omnix
      </span>
    </Link>
  );
}

export function AuthDriftOrb({
  x,
  y,
  size,
  color,
}: {
  x: string;
  y: string;
  size: number;
  color: string;
}) {
  return (
    <div
      className="absolute pointer-events-none animate-[auth-drift_24s_ease-in-out_infinite]"
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle,${color} 0%,transparent 70%)`,
        transform: "translate(-50%,-50%)",
        filter: "blur(1px)",
      }}
    />
  );
}

export function AuthMovingGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.035]">
      <div
        className="h-full w-full animate-[auth-grid_22s_linear_infinite]"
        style={{
          backgroundImage: "linear-gradient(var(--omnix-rgba-0-255-255-0-5) 1px,transparent 1px),linear-gradient(90deg,var(--omnix-rgba-0-255-255-0-5) 1px,transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
    </div>
  );
}

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  icon: ReactNode;
  error?: string;
};

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  ({ className, label, hint, icon, id, error, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <label className="group flex flex-col gap-1.5" htmlFor={inputId}>
        <span className="text-xs font-bold text-[var(--omnix-text-2)]">
          {label}
        </span>
        <span className="relative block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-cyan-300">
            {icon}
          </span>
          <input
            ref={ref}
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={error ? true : ariaInvalid}
            className={cn(
              "w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white outline-none transition-all duration-200",
              "placeholder:text-white/30 hover:border-white/[0.16] focus:border-cyan-300/40 focus:bg-white/[0.055] focus:ring-2 focus:ring-cyan-300/10",
              "disabled:cursor-not-allowed disabled:opacity-55",
              className,
            )}
            {...props}
          />
        </span>
        {hint ? <span className="text-xs leading-5 text-[var(--omnix-text-3)]">{hint}</span> : null}
        {error ? (
          <span id={errorId} className="text-xs leading-5 text-rose-200">
            {error}
          </span>
        ) : null}
      </label>
    );
  },
);

AuthInput.displayName = "AuthInput";
