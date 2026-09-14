"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Alert } from "@/components/ui/Alert";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import {
  EmailOtpCard,
  EmailOtpSuccess,
  emptyOtpDigits,
  OTP_LENGTH,
  otpCodeFromDigits,
} from "@/components/auth/EmailOtpCard";
import {
  AUTH_ICONS,
  AuthIcon,
  AuthInput,
} from "@/components/auth/OmnixAuthVisuals";
import { apiClient } from "@/lib/api";
import { authLink, redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast-context";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;
const OTP_DELIVERY_HINT =
  "Check your inbox. If the OTP is not there, look in your spam folder too.";

type LoginMode = "password" | "otp";
type LoginStep = "entry" | "otp" | "verified";
type LoginFieldErrors = { email?: string; password?: string; otp?: string };

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("rate") || message.includes("security") || message.includes("too many");
}

function otpSendErrorMessage(error: unknown) {
  if (isRateLimitError(error)) {
    return "Please wait a minute before requesting another verification code.";
  }
  return "Unable to send a verification code. Check that this email has an Omnix account, then try again.";
}

export function LoginForm() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession } = useAuth();
  const { showToast } = useToast();
  const [mode, setMode] = useState<LoginMode>("password");
  const [step, setStep] = useState<LoginStep>("entry");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(emptyOtpDigits);
  const [otpFocusKey, setOtpFocusKey] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});

  const otpCode = otpCodeFromDigits(otpDigits);
  const loading = signingIn || sendingCode || resendingCode || verifyingCode;

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((current) => Math.max(current - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  function beginResendCooldown() {
    setResendSeconds(RESEND_COOLDOWN_SECONDS);
  }

  function resetFeedback() {
    setError(null);
    setNotice(null);
    setFieldErrors({});
  }

  function validateEmail(nextEmail: string) {
    if (!nextEmail) return "Enter your email address.";
    if (!EMAIL_PATTERN.test(nextEmail)) return "Enter a valid email address.";
    return null;
  }

  function modeButtonClass(nextMode: LoginMode) {
    const active = mode === nextMode;
    return cn(
      "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-black transition",
      active
        ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-100 shadow-[0_0_24px_var(--omnix-rgba-0-255-255-0-12)]"
        : "border-white/[0.08] bg-white/[0.03] text-white/42 hover:border-white/[0.16] hover:bg-white/[0.055] hover:text-white",
    );
  }

  function changeMode(nextMode: LoginMode) {
    if (loading || mode === nextMode) return;
    setMode(nextMode);
    setStep("entry");
    setOtpDigits(emptyOtpDigits());
    setResendSeconds(0);
    resetFeedback();
  }

  async function sendLoginCode(targetEmail: string) {
    if (!supabase) {
      throw new Error(authError ?? "Authentication is not configured.");
    }

    return supabase.auth.signInWithOtp({
      email: targetEmail,
      options: {
        shouldCreateUser: false,
      },
    });
  }

  async function completeLogin() {
    await refreshSession();
    try {
      await apiClient.post("/email/welcome");
    } catch (emailErr) {
      logClientError("Welcome email request failed", emailErr);
    }
    router.replace(redirectFromWindow());
  }

  async function handlePasswordSubmit(formEmail: string, formPassword: string) {
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    const nextEmail = normalizeEmail(formEmail);
    const nextFieldErrors: LoginFieldErrors = {};
    const emailError = validateEmail(nextEmail);
    if (emailError) nextFieldErrors.email = emailError;
    if (!formPassword) {
      nextFieldErrors.password = "Enter your password.";
    } else if (formPassword.length < 8) {
      nextFieldErrors.password = "Use at least 8 characters.";
    }

    resetFeedback();
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Check the highlighted fields and try again.");
      return;
    }

    setSigningIn(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: nextEmail,
        password: formPassword,
      });

      if (signInError) {
        logClientError("Password sign in failed", signInError);
        setError("Unable to sign in. Check your email and password, then try again.");
        setFieldErrors({
          email: "Check this email address.",
          password: "Check this password.",
        });
        setSigningIn(false);
        return;
      }

      if (!data.session) {
        setError("Login succeeded but Supabase did not return a session.");
        setSigningIn(false);
        return;
      }

      await completeLogin();
      setSigningIn(false);
    } catch (err) {
      logClientError("Unexpected password sign in failure", err);
      setError("Unable to sign in. Check your connection and try again.");
      setSigningIn(false);
    }
  }

  async function handleOtpEmailSubmit(formEmail: string) {
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    const nextEmail = normalizeEmail(formEmail);
    const nextFieldErrors: LoginFieldErrors = {};
    const emailError = validateEmail(nextEmail);
    if (emailError) nextFieldErrors.email = emailError;

    resetFeedback();
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Check the highlighted field and try again.");
      return;
    }

    setSendingCode(true);

    try {
      const { error: otpError } = await sendLoginCode(nextEmail);

      if (otpError) {
        logClientError("Email OTP request failed", otpError);
        setError(otpSendErrorMessage(otpError));
        setFieldErrors({ email: "Check this email address or create an account first." });
        setSendingCode(false);
        return;
      }

      setEmail(nextEmail);
      setOtpDigits(emptyOtpDigits());
      setStep("otp");
      setNotice(`We sent a 6-digit code to ${nextEmail}.`);
      showToast({
        title: "OTP sent",
        message: OTP_DELIVERY_HINT,
        variant: "info",
        durationMs: 5200,
      });
      beginResendCooldown();
      setOtpFocusKey((current) => current + 1);
      setSendingCode(false);
    } catch (err) {
      logClientError("Unexpected email OTP request failure", err);
      setError("Unable to send a verification code. Check your connection and try again.");
      setSendingCode(false);
    }
  }

  async function handleOtpSubmit() {
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    resetFeedback();

    if (otpCode.length !== OTP_LENGTH) {
      setError("Enter the complete 6-digit verification code.");
      setFieldErrors({ otp: "Enter all 6 digits." });
      setOtpFocusKey((current) => current + 1);
      return;
    }

    setVerifyingCode(true);

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: "email",
      });

      if (verifyError) {
        logClientError("Email OTP verification failed", verifyError);
        setError("That verification code did not work. Check the code or request a new one.");
        setFieldErrors({ otp: "Check this code." });
        setVerifyingCode(false);
        setOtpFocusKey((current) => current + 1);
        return;
      }

      if (!data.session) {
        setError("Verification succeeded but Supabase did not return a session.");
        setVerifyingCode(false);
        return;
      }

      setStep("verified");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      await completeLogin();
      setVerifyingCode(false);
    } catch (err) {
      logClientError("Unexpected email OTP verification failure", err);
      setError("Unable to verify the code. Check your connection and try again.");
      setVerifyingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "otp") {
      await handleOtpSubmit();
      return;
    }

    const formData = new FormData(event.currentTarget);
    const formEmail = String(formData.get("email") ?? "");

    if (mode === "password") {
      await handlePasswordSubmit(formEmail, String(formData.get("password") ?? ""));
      return;
    }

    await handleOtpEmailSubmit(formEmail);
  }

  async function handleResendCode() {
    if (!email || !supabase || resendSeconds > 0) return;

    setError(null);
    setNotice(null);
    setFieldErrors({});
    setResendingCode(true);

    try {
      const { error: otpError } = await sendLoginCode(email);

      if (otpError) {
        logClientError("Email OTP resend failed", otpError);
        setError(otpSendErrorMessage(otpError));
        setResendingCode(false);
        return;
      }

      setOtpDigits(emptyOtpDigits());
      setNotice(`A new code was sent to ${email}.`);
      showToast({
        title: "OTP sent again",
        message: OTP_DELIVERY_HINT,
        variant: "info",
        durationMs: 5200,
      });
      beginResendCooldown();
      setOtpFocusKey((current) => current + 1);
      setResendingCode(false);
    } catch (err) {
      logClientError("Unexpected email OTP resend failure", err);
      setError("Unable to resend the code. Check your connection and try again.");
      setResendingCode(false);
    }
  }

  function handleChangeEmail() {
    setStep("entry");
    setOtpDigits(emptyOtpDigits());
    setResendSeconds(0);
    resetFeedback();
  }

  if (step === "verified") {
    return <EmailOtpSuccess email={email} />;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 sm:gap-5">
      {!isConfigured ? (
        <Alert variant="warning" title="Authentication is not configured">
          {authError}
        </Alert>
      ) : null}
      {error && (
        <Alert variant="error" title="Unable to sign in">
          {error}
        </Alert>
      )}
      {notice ? (
        <div className="auth-info-note rounded-2xl p-3 text-xs leading-5" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
      <OAuthButtons disabled={loading || !isConfigured} mode="login" onError={setError} />
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="auth-divider-line h-px w-full" />
        </div>
        <div className="relative flex justify-center">
          <span className="auth-divider-label px-3 text-xs">
            or continue with email
          </span>
        </div>
      </div>

      {step === "entry" ? (
        <>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1.5" role="tablist" aria-label="Email sign-in method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "password"}
              className={modeButtonClass("password")}
              onClick={() => changeMode("password")}
              disabled={loading}
            >
              <AuthIcon d={AUTH_ICONS.lock} size={14} stroke="currentColor" sw={2} />
              Password
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "otp"}
              className={modeButtonClass("otp")}
              onClick={() => changeMode("otp")}
              disabled={loading}
            >
              <AuthIcon d={AUTH_ICONS.mail} size={14} stroke="currentColor" sw={2} />
              Email code
            </button>
          </div>
          <AuthInput
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
            icon={<AuthIcon d={AUTH_ICONS.mail} size={16} stroke="currentColor" sw={1.8} />}
            disabled={loading || !isConfigured}
            error={fieldErrors.email}
          />
          {mode === "password" ? (
            <AuthInput
              id="password"
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              minLength={8}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              icon={<AuthIcon d={AUTH_ICONS.lock} size={16} stroke="currentColor" sw={1.8} />}
              disabled={loading || !isConfigured}
              error={fieldErrors.password}
            />
          ) : null}
        </>
      ) : (
        <EmailOtpCard
          email={email}
          digits={otpDigits}
          onDigitsChange={(nextDigits) => {
            setOtpDigits(nextDigits);
            setError(null);
            setFieldErrors((current) => ({ ...current, otp: undefined }));
          }}
          disabled={loading || !isConfigured}
          error={fieldErrors.otp}
          isResending={resendingCode}
          resendSeconds={resendSeconds}
          onResend={handleResendCode}
          onChangeEmail={handleChangeEmail}
          autoFocusKey={otpFocusKey}
        />
      )}

      <LoadingButton
        type="submit"
        size="lg"
        className="w-full rounded-xl border-0 bg-[var(--omnix-cyan)] py-3.5 text-sm font-black text-[var(--omnix-color-061020)] shadow-[0_0_32px_var(--omnix-rgba-0-255-255-0-3)] hover:-translate-y-0.5 hover:bg-[var(--omnix-cyan)] hover:shadow-[0_0_50px_var(--omnix-rgba-0-255-255-0-55)]"
        isLoading={signingIn || sendingCode || verifyingCode}
        loadingText={step === "otp" ? "Verifying" : mode === "password" ? "Signing in" : "Sending code"}
        disabled={!isConfigured || resendingCode}
        rightIcon={<AuthIcon d={step === "otp" ? AUTH_ICONS.check : AUTH_ICONS.arrow} size={16} stroke="var(--omnix-color-061020)" sw={2.5} />}
      >
        {step === "otp" ? "Verify and sign in" : mode === "password" ? "Sign in with password" : "Send verification code"}
      </LoadingButton>
      <div className="auth-info-note flex items-start gap-3 rounded-2xl p-3 text-xs leading-5">
        <span className="auth-text-cyan mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
          <AuthIcon d={AUTH_ICONS.check} size={10} stroke="currentColor" sw={2.5} />
        </span>
        {mode === "password"
          ? "Use your account password, or switch to email code when you prefer passwordless sign-in."
          : "We email a one-time code to keep workspace research, files, and team history tied to your account."}
      </div>
      <p className="auth-text-faint text-center text-xs">
        New to Omnix?{" "}
        <Link
          href={authLink("/register")}
          className="auth-text-cyan font-semibold transition hover:opacity-80"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
