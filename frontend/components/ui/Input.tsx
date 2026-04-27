"use client";
import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={cn(
            "w-full bg-gray-900/50 border rounded-xl px-4 py-3 text-white placeholder-gray-500 transition-all",
            "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-gray-800/80",
            error ? "border-red-500 focus:ring-red-500" : "border-gray-700 hover:border-gray-600",
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-sm text-red-500 font-medium">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
