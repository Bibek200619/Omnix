"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-teal-300 text-stone-950 shadow-[0_14px_32px_rgba(45,212,191,0.18)] hover:bg-teal-200",
  secondary:
    "border border-white/12 bg-white/[0.07] text-stone-100 hover:border-white/20 hover:bg-white/[0.11]",
  ghost: "text-stone-300 hover:bg-white/[0.07] hover:text-white",
  danger:
    "border border-rose-300/25 bg-rose-400/12 text-rose-100 hover:bg-rose-400/18"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 gap-2 rounded-md px-3 text-sm",
  md: "h-11 gap-2 rounded-md px-4 text-sm",
  lg: "h-12 gap-2 rounded-md px-5 text-base",
  icon: "h-10 w-10 rounded-md p-0"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      fullWidth = false,
      type = "button",
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55",
          variants[variant],
          sizes[size],
          fullWidth && "w-full",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
