"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { OTPInput } from "@/components/ui/OTPInput";
import { supabase } from "@/lib/supabase";

export function VerifyForm() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const pendingEmail = localStorage.getItem("pendingVerificationEmail");
    setEmail(pendingEmail);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otp.length !== 6 || !email) return;
    setError(null);
    setLoading(true);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "signup",
      });

      if (verifyError) {
        setError(verifyError.message || "Verification failed. Please check the code.");
        setLoading(false);
        return;
      }

      localStorage.removeItem("pendingVerificationEmail");
      router.push("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {email && (
        <p className="text-sm text-slate-400">
          Verification code sent to <span className="text-slate-200">{email}</span>
        </p>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-200">
          Verification code
        </label>
        <OTPInput value={otp} onChange={setOtp} disabled={loading} />
      </div>
      <LoadingButton
        type="submit"
        className="w-full"
        isLoading={loading}
        disabled={otp.length !== 6}
        leftIcon={<ShieldCheck className="h-4 w-4" />}
      >
        Verify
      </LoadingButton>
    </form>
  );
}
