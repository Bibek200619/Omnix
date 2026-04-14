"use client";

import { useState } from "react";
import { Github, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { oauthCallbackUrl, redirectFromWindow } from "@/lib/auth-redirects";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type OAuthProvider = "google" | "github";

type OAuthButtonsProps = {
  disabled?: boolean;
  mode?: "login" | "register";
  onError?: (message: string | null) => void;
};

const providerLabels: Record<OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
};

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#EA4335"
        d="M12 5.04c1.69 0 3.2.58 4.4 1.72l3.28-3.28C17.7 1.64 15.11.5 12 .5 7.55.5 3.73 3.05 1.86 6.76l3.82 2.97C6.59 6.97 9.16 5.04 12 5.04Z"
      />
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.55-.2-2.27H12v4.29h6.47a5.53 5.53 0 0 1-2.4 3.63l3.71 2.88c2.17-2 3.42-4.94 3.42-8.53Z"
      />
      <path
        fill="#FBBC05"
        d="M5.68 14.27a7.21 7.21 0 0 1 0-4.54L1.86 6.76A11.45 11.45 0 0 0 .5 12c0 1.88.45 3.66 1.36 5.24l3.82-2.97Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.11 0 5.72-1.03 7.63-2.8l-3.71-2.88c-1.03.69-2.35 1.1-3.92 1.1-2.84 0-5.41-1.93-6.32-4.65l-3.82 2.97C3.73 20.95 7.55 23.5 12 23.5Z"
      />
    </svg>
  );
}

function providerIcon(provider: OAuthProvider, loading: boolean) {
  if (loading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (provider === "google") return <GoogleIcon />;
  return <Github className="h-4 w-4" />;
}

function oauthErrorMessage(provider: OAuthProvider, error: unknown) {
  const providerName = providerLabels[provider];
  if (error instanceof Error && error.message) {
    return `${providerName} sign-in could not start. ${error.message}`;
  }
  return `${providerName} sign-in could not start. Please try again.`;
}

export function OAuthButtons({ disabled = false, mode = "login", onError }: OAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function continueWith(provider: OAuthProvider) {
    if (!supabase || loadingProvider) return;

    setLoadingProvider(provider);
    setLocalError(null);
    onError?.(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: oauthCallbackUrl(redirectFromWindow()),
        },
      });

      if (error) {
        const message = oauthErrorMessage(provider, error);
        setLocalError(message);
        onError?.(message);
        setLoadingProvider(null);
      }
    } catch (err) {
      const message = oauthErrorMessage(provider, err);
      setLocalError(message);
      onError?.(message);
      setLoadingProvider(null);
    }
  }

  const action = mode === "register" ? "Sign up" : "Continue";

  return (
    <div className="space-y-3">
      {localError ? (
        <Alert variant="error" title="OAuth sign-in failed">
          {localError}
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["google", "github"] as OAuthProvider[]).map((provider) => {
          const isLoading = loadingProvider === provider;
          return (
            <Button
              key={provider}
              type="button"
              variant="secondary"
              size="lg"
              disabled={disabled || Boolean(loadingProvider)}
              onClick={() => continueWith(provider)}
              leftIcon={providerIcon(provider, isLoading)}
              className={cn(
                "w-full justify-center border-white/12 bg-white/[0.045] text-sm font-bold hover:-translate-y-0.5 hover:border-cyan-300/25 hover:bg-white/[0.08]",
                isLoading && "border-cyan-300/30 bg-cyan-300/10 text-cyan-50",
              )}
            >
              {isLoading ? "Redirecting" : `${action} with ${providerLabels[provider]}`}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
