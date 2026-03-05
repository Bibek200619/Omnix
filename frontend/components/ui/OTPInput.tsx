"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

type OTPInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
};

export function OTPInput({
  value,
  onChange,
  length = 6,
  disabled = false,
}: OTPInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  function updateDigit(index: number, nextValue: string) {
    const digit = nextValue.replace(/\D/g, "").slice(-1);
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));

    if (digit && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(text: string) {
    const pasted = text.replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="grid grid-cols-6 gap-2" aria-label="One-time password">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          onPaste={(event) => {
            event.preventDefault();
            handlePaste(event.clipboardData.getData("text"));
          }}
          onChange={(event) => updateDigit(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) {
              refs.current[index - 1]?.focus();
            }
          }}
          className={cn(
            "aspect-square min-h-12 rounded-lg border border-white/10 bg-white/[0.04] text-center text-lg font-semibold text-white outline-none transition",
            "focus:border-cyan-300/70 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
      ))}
    </div>
  );
}
