"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  icon?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, icon, id, ...props }, ref) => {
    return (
      <label className="block space-y-2" htmlFor={id}>
        {label ? (
          <span className="text-sm font-medium text-slate-200">{label}</span>
        ) : null}
        <span className="relative block">
          {icon ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              {icon}
            </span>
          ) : null}
          <input
            ref={ref}
            id={id}
            className={cn(
              "h-11 w-full rounded-lg border border-white/10 bg-white/[0.045] px-3 text-sm text-white outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition",
              "placeholder:text-slate-500 hover:border-white/15 focus:border-cyan-300/70 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-300/15",
              icon && "pl-10",
              className,
            )}
            {...props}
          />
        </span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </label>
    );
  },
);

Input.displayName = "Input";
