"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-cyan-300/40 bg-cyan-300 text-slate-950 shadow-glow hover:bg-cyan-200 hover:shadow-cyan-300/20",
  secondary:
    "border-white/10 bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-white/20 hover:bg-white/[0.1]",
  ghost:
    "border-transparent bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white",
  danger:
    "border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 gap-2 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2.5 px-5 text-base",
  icon: "h-10 w-10 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border font-medium transition-all duration-200 active:scale-[0.96]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "group/btn",
          variants[variant],
          sizes[size],
          className,
        )}
        disabled={isDisabled}
        {...props}
      >
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent opacity-0 transition-opacity duration-500 group-hover/btn:opacity-100" style={{ transform: 'skewX(-25deg) translateX(-100%)', animation: 'omnix-beam-sweep 3s infinite' }} />
        <span className="relative z-10 flex items-center gap-2">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
          {children}
          {!isLoading ? rightIcon : null}
        </span>
      </button>
    );
  },
);

Button.displayName = "Button";
