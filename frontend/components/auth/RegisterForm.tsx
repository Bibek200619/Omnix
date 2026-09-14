"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { LoadingButton } from "@/components/ui/LoadingButton";
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
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { authLink, redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/lib/toast-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;
const OTP_DELIVERY_HINT =
  "Check your inbox. If the OTP is not there, look in your spam folder too.";

type RegisterStep = "form" | "otp" | "verified";
type RegisterFieldErrors = {
  handle?: string;
  email?: string;
  phone?: string;
  password?: string;
  otp?: string;
};
type PendingSignup = {
  name: string;
  handle: string;
  email: string;
  phoneNumber: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("rate") || message.includes("security") || message.includes("too many");
}

function signupOtpErrorMessage(error: unknown) {
  if (isRateLimitError(error)) {
    return "Please wait a minute before requesting another verification code.";
  }
  return "Unable to send a new verification code. Check your connection and try again.";
}

export function RegisterForm() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession } = useAuth();
  const { showToast } = useToast();
  const [step, setStep] = useState<RegisterStep>("form");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [otpFocusKey, setOtpFocusKey] = useState(0);
  const [otpDigits, setOtpDigits] = useState<string[]>(emptyOtpDigits);
  const [pendingSignup, setPendingSignup] = useState<PendingSignup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [phoneCountryCode, setPhoneCountryCode] = useState("+1");

  const otpCode = otpCodeFromDigits(otpDigits);
  const loading = creatingAccount || verifyingCode || resendingCode;

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

  async function completeSignup(profile: PendingSignup) {
    await refreshSession();
    await apiClient.patch("/profile", {
      display_name: profile.name || undefined,
      username: profile.handle,
      phone_number: profile.phoneNumber,
    });

    try {
      await apiClient.post("/email/welcome");
    } catch (emailErr) {
      logClientError("Welcome email request failed", emailErr);
    }

    await refreshSession();
    router.replace(redirectFromWindow());
  }

  async function verifySignupCode(email: string, token: string) {
    if (!supabase) {
      throw new Error(authError ?? "Authentication is not configured.");
    }

    const primary = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (!primary.error) {
      return primary;
    }

    const fallback = await supabase.auth.verifyOtp({
      email,
      token,
      type: "signup",
    });

    return fallback.error ? primary : fallback;
  }

  async function handleSignupOtpSubmit() {
    if (!supabase || !pendingSignup) {
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
      const { data, error: verifyError } = await verifySignupCode(pendingSignup.email, otpCode);

      if (verifyError) {
        logClientError("Signup OTP verification failed", verifyError);
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
      await completeSignup(pendingSignup);
      setVerifyingCode(false);
    } catch (err) {
      logClientError("Unexpected signup OTP verification failure", err);
      setError("Unable to verify the code. Check your connection and try again.");
      setVerifyingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (step === "otp") {
      await handleSignupOtpSubmit();
      return;
    }

    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const handle = String(formData.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    const phone = String(formData.get("phone") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const phoneDigits = phone.replace(/\D/g, "");
    const normalizedPhone = `${phoneCountryCode}${phoneDigits}`;
    const nextFieldErrors: RegisterFieldErrors = {};

    if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) {
      nextFieldErrors.handle = "Use 3-30 lowercase letters, numbers, hyphens, or underscores.";
    }
    if (!email) {
      nextFieldErrors.email = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(email)) {
      nextFieldErrors.email = "Enter a valid email address.";
    }
    if (!phoneDigits) {
      nextFieldErrors.phone = "Enter your phone number.";
    } else if (!/^\+[1-9]\d{6,19}$/.test(normalizedPhone)) {
      nextFieldErrors.phone = "Choose a country code and enter 6-20 digits.";
    }
    if (!password) {
      nextFieldErrors.password = "Create a password.";
    } else if (password.length < 8) {
      nextFieldErrors.password = "Use at least 8 characters.";
    }

    resetFeedback();
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Check the highlighted fields and try again.");
      return;
    }

    setCreatingAccount(true);

    const signupProfile: PendingSignup = {
      name,
      handle,
      email,
      phoneNumber: normalizedPhone,
    };

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name || undefined,
            username: handle,
            phone_number: normalizedPhone,
          },
        },
      });

      if (signUpError) {
        logClientError("Registration failed", signUpError);
        setError("Unable to create account. Check the details and try again.");
        setFieldErrors({
          email: "Check this email address or sign in instead.",
        });
        setCreatingAccount(false);
        return;
      }

      if (data.session) {
        await completeSignup(signupProfile);
        setCreatingAccount(false);
        return;
      }

      setPendingSignup(signupProfile);
      setOtpDigits(emptyOtpDigits());
      setStep("otp");
      setNotice(`We sent a 6-digit verification code to ${email}.`);
      showToast({
        title: "OTP sent",
        message: OTP_DELIVERY_HINT,
        variant: "info",
        durationMs: 5200,
      });
      beginResendCooldown();
      setOtpFocusKey((current) => current + 1);
      setCreatingAccount(false);
    } catch (err) {
      logClientError("Unexpected registration failure", err);
      setError("Unable to create account. Check your connection and try again.");
      setCreatingAccount(false);
    }
  }

  async function handleResendSignupCode() {
    if (!pendingSignup || !supabase || resendSeconds > 0) return;

    setError(null);
    setNotice(null);
    setFieldErrors({});
    setResendingCode(true);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: pendingSignup.email,
      });

      if (resendError) {
        logClientError("Signup OTP resend failed", resendError);
        setError(signupOtpErrorMessage(resendError));
        setResendingCode(false);
        return;
      }

      setOtpDigits(emptyOtpDigits());
      setNotice(`A new verification code was sent to ${pendingSignup.email}.`);
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
      logClientError("Unexpected signup OTP resend failure", err);
      setError("Unable to resend the code. Check your connection and try again.");
      setResendingCode(false);
    }
  }

  function handleChangeDetails() {
    setStep("form");
    setPendingSignup(null);
    setOtpDigits(emptyOtpDigits());
    setResendSeconds(0);
    resetFeedback();
  }

  if (step === "verified" && pendingSignup) {
    return <EmailOtpSuccess email={pendingSignup.email} message="Finishing your account setup..." />;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 sm:gap-5">
      {!isConfigured ? (
        <Alert variant="warning" title="Authentication is not configured">
          {authError}
        </Alert>
      ) : null}
      {error && (
        <Alert variant="error" title="Unable to create account">
          {error}
        </Alert>
      )}
      {notice ? (
        <div className="auth-info-note rounded-2xl p-3 text-xs leading-5" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
      {step === "form" ? (
        <>
          <OAuthButtons disabled={loading || !isConfigured} mode="register" onError={setError} />
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="auth-divider-line h-px w-full" />
            </div>
            <div className="relative flex justify-center">
              <span className="auth-divider-label px-3 text-xs">
                or create with email
              </span>
            </div>
          </div>
          <AuthInput
            id="name"
            name="name"
            label="Name"
            type="text"
            autoComplete="name"
            placeholder="Alex Morgan"
            icon={<AuthIcon d={AUTH_ICONS.user} size={16} stroke="currentColor" sw={1.8} />}
            disabled={loading || !isConfigured}
          />
          <AuthInput
            id="handle"
            name="handle"
            label="Omnix handle"
            type="text"
            autoComplete="username"
            placeholder="alex-morgan"
            required
            minLength={3}
            maxLength={30}
            icon={<AuthIcon d={AUTH_ICONS.at} size={16} stroke="currentColor" sw={1.8} />}
            hint="Unique ID for workspace invites. Lowercase letters, numbers, hyphens, and underscores."
            disabled={loading || !isConfigured}
            error={fieldErrors.handle}
          />
          <AuthInput
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            icon={<AuthIcon d={AUTH_ICONS.mail} size={16} stroke="currentColor" sw={1.8} />}
            disabled={loading || !isConfigured}
            error={fieldErrors.email}
          />
          <label className="group flex flex-col gap-1.5" htmlFor="phone">
            <span className="text-xs font-bold text-[var(--omnix-text-2)]">
              Phone number
            </span>
            <span className="relative flex rounded-xl border border-white/[0.08] bg-white/[0.04] transition-all duration-200 hover:border-white/[0.16] focus-within:border-cyan-300/40 focus-within:bg-white/[0.055] focus-within:ring-2 focus-within:ring-cyan-300/10">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-cyan-300">
                <AuthIcon d={AUTH_ICONS.phone} size={16} stroke="currentColor" sw={1.8} />
              </span>
              <select
                aria-label="Country code"
                value={phoneCountryCode}
                onChange={(event) => setPhoneCountryCode(event.target.value)}
                disabled={loading || !isConfigured}
                className="ml-10 my-2 h-9 w-[84px] shrink-0 rounded-md border border-white/[0.08] bg-black/20 px-2 text-xs font-semibold text-cyan-100 outline-none transition hover:border-white/[0.16] focus:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <option value="+1">US +1</option>
                <option value="+91">IN +91</option>
                <option value="+44">UK +44</option>
                <option value="+61">AU +61</option>
                <option value="+971">AE +971</option>
                <option value="+977">NP +977</option>
                <option value="+81">JP +81</option>
                <option value="+49">DE +49</option>
              </select>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel-national"
                placeholder="555 123 4567"
                required
                aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
                aria-invalid={fieldErrors.phone ? true : undefined}
                disabled={loading || !isConfigured}
                className={cn(
                  "min-w-0 flex-1 rounded-r-xl bg-transparent py-3 pl-3 pr-4 text-sm text-white outline-none transition-all duration-200",
                  "placeholder:text-white/30 disabled:cursor-not-allowed disabled:opacity-55",
                )}
              />
            </span>
            <span className="text-xs leading-5 text-[var(--omnix-text-3)]">
              Used to complete your account profile.
            </span>
            {fieldErrors.phone ? (
              <span id="phone-error" className="text-xs leading-5 text-rose-200">
                {fieldErrors.phone}
              </span>
            ) : null}
          </label>
          <AuthInput
            id="password"
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a secure password"
            required
            minLength={8}
            icon={<AuthIcon d={AUTH_ICONS.lock} size={16} stroke="currentColor" sw={1.8} />}
            hint="Use at least 8 characters."
            disabled={loading || !isConfigured}
            error={fieldErrors.password}
          />
          <div className="auth-info-note auth-info-note-strong rounded-2xl p-3 text-xs leading-5">
            First-time email registration verifies your mailbox with a one-time code.
            Google and GitHub continue through their provider without an extra code.
          </div>
        </>
      ) : pendingSignup ? (
        <EmailOtpCard
          email={pendingSignup.email}
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
          onResend={handleResendSignupCode}
          onChangeEmail={handleChangeDetails}
          title="Verify your new account"
          autoFocusKey={otpFocusKey}
        />
      ) : null}
      <LoadingButton
        type="submit"
        size="lg"
        className="w-full rounded-xl border-0 bg-[var(--omnix-cyan)] py-3.5 text-sm font-black text-[var(--omnix-color-061020)] shadow-[0_0_32px_var(--omnix-rgba-0-255-255-0-3)] hover:-translate-y-0.5 hover:bg-[var(--omnix-cyan)] hover:shadow-[0_0_50px_var(--omnix-rgba-0-255-255-0-55)]"
        isLoading={creatingAccount || verifyingCode}
        loadingText={step === "otp" ? "Verifying" : "Creating account"}
        disabled={!isConfigured || resendingCode}
        leftIcon={step === "form" ? <AuthIcon d={AUTH_ICONS.user} size={16} stroke="var(--omnix-color-061020)" sw={2.1} /> : undefined}
        rightIcon={<AuthIcon d={step === "otp" ? AUTH_ICONS.check : AUTH_ICONS.arrow} size={16} stroke="var(--omnix-color-061020)" sw={2.5} />}
      >
        {step === "otp" ? "Verify and create account" : "Create account"}
      </LoadingButton>
      <p className="auth-text-faint text-center text-xs">
        Already have an account?{" "}
        <Link
          href={authLink("/login")}
          className="auth-text-cyan font-semibold transition hover:opacity-80"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
