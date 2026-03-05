"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <label className="block" htmlFor={inputId}>
        {label ? (
          <span className="mb-2 block text-sm font-medium text-stone-200">{label}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-12 w-full rounded-md border border-white/10 bg-white/[0.06] px-3.5 text-sm text-stone-50 outline-none transition placeholder:text-stone-500 focus:border-teal-200/65 focus:bg-white/[0.09] focus:ring-4 focus:ring-teal-200/10",
            error && "border-rose-300/50 focus:border-rose-200 focus:ring-rose-300/10",
            className
          )}
          {...props}
        />
        {error ? <span className="mt-2 block text-sm text-rose-200">{error}</span> : null}
      </label>
    );
  }
);

Input.displayName = "Input";
