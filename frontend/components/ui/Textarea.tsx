"use client";

import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, id, error, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const hintId = hint ? `${textareaId}-hint` : undefined;
    const errorId = error ? `${textareaId}-error` : undefined;
    const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <label className="block space-y-2" htmlFor={textareaId}>
        {label ? (
          <span className="text-sm font-medium text-slate-200">{label}</span>
        ) : null}
        <textarea
          ref={ref}
          id={textareaId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : ariaInvalid}
          className={cn(
            "min-h-24 w-full rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2 text-sm leading-6 text-white outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition",
            "placeholder:text-slate-500 hover:border-white/15 focus:border-cyan-300/70 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-300/15",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
          {...props}
        />
        {hint ? (
          <span id={hintId} className="block text-xs text-slate-500">
            {hint}
          </span>
        ) : null}
        {error ? (
          <span id={errorId} className="block text-xs leading-5 text-rose-200">
            {error}
          </span>
        ) : null}
      </label>
    );
  },
);

Textarea.displayName = "Textarea";
