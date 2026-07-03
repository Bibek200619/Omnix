"use client";

import {
  ClipboardEvent,
  Dispatch,
  KeyboardEvent,
  SetStateAction,
  useEffect,
  useRef,
} from "react";
import { AUTH_ICONS, AuthIcon } from "@/components/auth/OmnixAuthVisuals";

export const OTP_LENGTH = 6;

export function emptyOtpDigits() {
  return Array.from({ length: OTP_LENGTH }, () => "");
}

export function otpCodeFromDigits(digits: string[]) {
  return digits.join("");
}

type EmailOtpCardProps = {
  email: string;
  digits: string[];
  onDigitsChange: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  error?: string;
  isResending?: boolean;
  resendSeconds?: number;
  onResend: () => void;
  onChangeEmail?: () => void;
  title?: string;
  autoFocusKey?: string | number;
};

export function EmailOtpCard({
  email,
  digits,
  onDigitsChange,
  disabled = false,
  error,
  isResending = false,
  resendSeconds = 0,
  onResend,
  onChangeEmail,
  title = "Verify your email",
  autoFocusKey,
}: EmailOtpCardProps) {
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  function focusOtp(index = 0) {
    window.requestAnimationFrame(() => {
      otpRefs.current[index]?.focus();
    });
  }

  useEffect(() => {
    if (autoFocusKey !== undefined) {
      focusOtp();
    }
  }, [autoFocusKey]);

  function applyOtpValue(index: number, value: string) {
    const nextDigits = value.replace(/\D/g, "").slice(0, OTP_LENGTH - index);

    onDigitsChange((current) => {
      const next = [...current];
      if (!nextDigits) {
        next[index] = "";
        return next;
      }

      nextDigits.split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      return next;
    });

    if (nextDigits) {
      focusOtp(Math.min(index + nextDigits.length, OTP_LENGTH - 1));
    }
  }

  function handleOtpKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      onDigitsChange((current) => {
        const next = [...current];
        next[index - 1] = "";
        return next;
      });
      focusOtp(index - 1);
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusOtp(index - 1);
    }

    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      focusOtp(index + 1);
    }
  }

  function handleOtpPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    applyOtpValue(index, event.clipboardData.getData("text"));
  }

  const resendDisabled = disabled || isResending || resendSeconds > 0;
  const resendLabel = isResending
    ? "Sending..."
    : resendSeconds > 0
      ? `Resend in ${resendSeconds}s`
      : "Resend";

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_var(--omnix-rgba-255-255-255-0-035)]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="auth-text-white text-sm font-black">{title}</p>
          <p className="mt-1 break-all text-xs leading-5 text-white/38">{email}</p>
        </div>
        {onChangeEmail ? (
          <button
            type="button"
            onClick={onChangeEmail}
            disabled={disabled}
            className="shrink-0 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-bold text-white/55 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Change
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-white/55" htmlFor="otp-0">
          Verification code
        </label>
        <div className="grid grid-cols-6 gap-2 sm:gap-3" aria-describedby={error ? "otp-error" : undefined}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(node) => {
                otpRefs.current[index] = node;
              }}
              id={`otp-${index}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={index === 0 ? OTP_LENGTH : 1}
              value={digit}
              aria-label={`Verification code digit ${index + 1}`}
              aria-invalid={error ? true : undefined}
              disabled={disabled}
              onChange={(event) => applyOtpValue(index, event.target.value)}
              onKeyDown={(event) => handleOtpKeyDown(index, event)}
              onPaste={(event) => handleOtpPaste(index, event)}
              className="h-12 min-w-0 rounded-xl border border-white/[0.08] bg-[var(--omnix-rgba-255-255-255-0-04)] text-center text-lg font-black tabular-nums text-white outline-none transition-all duration-200 placeholder:text-white/20 hover:border-white/[0.16] focus:border-emerald-300/45 focus:bg-emerald-300/[0.06] focus:ring-2 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-55 sm:h-14 sm:text-xl"
            />
          ))}
        </div>
        {error ? (
          <span id="otp-error" className="text-xs leading-5 text-rose-200">
            {error}
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/35">
        <span>Didn&apos;t receive the code?</span>
        <button
          type="button"
          onClick={onResend}
          disabled={resendDisabled}
          className="font-black text-emerald-200 transition hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resendLabel}
        </button>
      </div>
    </div>
  );
}

type EmailOtpSuccessProps = {
  email: string;
  message?: string;
};

export function EmailOtpSuccess({
  email,
  message = "Redirecting to your workspace...",
}: EmailOtpSuccessProps) {
  return (
    <div className="auth-otp-success-panel rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.055] p-6 text-center shadow-[0_0_54px_var(--omnix-rgba-34-197-94-0-12)]">
      <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-[28px] border border-emerald-300/35 bg-emerald-300/10">
        <div className="auth-otp-success-check flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-200/45 bg-[var(--omnix-color-061020)] text-emerald-200 shadow-[0_0_30px_var(--omnix-rgba-34-197-94-0-5)]">
          <AuthIcon d={AUTH_ICONS.check} size={28} stroke="currentColor" sw={2.6} />
        </div>
      </div>
      <h2 className="auth-text-white text-2xl font-black">Verified successfully</h2>
      <p className="mt-2 text-sm leading-6 text-white/45">
        {email} has been verified. {message}
      </p>
    </div>
  );
}
