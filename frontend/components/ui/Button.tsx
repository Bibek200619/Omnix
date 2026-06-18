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
    "border-white/10 bg-white/[0.06] text-white shadow-[inset_0_1px_0_var(--omnix-rgba-rgba-255-255-255-0-04)] hover:border-white/20 hover:bg-white/[0.1]",
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
          "inline-flex shrink-0 items-center justify-center rounded-lg border font-medium transition duration-200 active:scale-[0.98]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:opacity-55",
          variants[variant],
          sizes[size],
          className,
        )}
        disabled={isDisabled}
        {...props}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
        {children}
        {!isLoading ? rightIcon : null}
      </button>
    );
  },
);

Button.displayName = "Button";
