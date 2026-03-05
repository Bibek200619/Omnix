"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { OTPInput } from "@/components/ui/OTPInput";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { supabase } from "@/lib/supabase";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const router = useRouter();

  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Email not found. Please restart the password reset process.");
      return;
    }
    if (otp.length !== 6) {
      setError("Please enter a valid 6-digit OTP.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Step 1: Verify the OTP to establish a session
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'recovery'
      });

      if (verifyError) throw verifyError;

      // Step 2: Update the user's password
      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) throw updateError;

      setSuccess("Password reset successfully! Redirecting...");
      setTimeout(() => {
        router.push("/chat");
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. Please check your OTP and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#030712] items-center justify-center p-4 w-full">
      {/* Background gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
        <div className="absolute bottom-[10%] -left-[10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]" />
        <div className="absolute -top-[10%] right-[10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px]" />
      </div>

      <AuthCard
        title="Create New Password"
        description="Enter the 6-digit code sent to your email and your new password."
        backLink={{ href: "/auth/login", label: "Back to login" }}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300 text-center mb-2">Enter 6-Digit Code</label>
            <OTPInput 
              length={6} 
              onComplete={(val) => setOtp(val)} 
              disabled={loading || !!success} 
            />
          </div>

          <div className="pt-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">New Password</label>
            <Input 
              type="password" 
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || !!success}
            />
          </div>

          <LoadingButton 
            type="submit" 
            className="w-full" 
            isLoading={loading}
            disabled={otp.length !== 6 || !!success}
          >
            Reset Password
          </LoadingButton>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm text-center">
            {success}
          </div>
        )}
      </AuthCard>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030712]" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
