"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { OTPInput } from "@/components/ui/OTPInput";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { supabase } from "@/lib/supabase";

function VerifyForm() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const router = useRouter();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleVerify = async () => {
    if (!email) {
      setError("Email not found. Please try registering again.");
      return;
    }
    if (otp.length !== 6) {
      setError("Please enter a valid 6-digit OTP.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup'
      });

      if (error) throw error;

      setSuccess("Account verified successfully! Redirecting...");
      setTimeout(() => {
        router.push("/chat");
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });

      if (error) throw error;
      setSuccess("A new OTP has been sent to your email.");
    } catch (err: any) {
      setError(err.message || "Failed to resend OTP.");
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
        title="Verify Your Email"
        description={email ? `We sent a 6-digit code to ${email}` : "Please enter the 6-digit code sent to your email."}
        backLink={{ href: "/auth/login", label: "Back to login" }}
      >
        <div className="space-y-8">
          <OTPInput 
            length={6} 
            onComplete={(val) => setOtp(val)} 
            disabled={loading || !!success} 
          />
          
          <div className="space-y-4">
            <LoadingButton 
              onClick={handleVerify} 
              className="w-full" 
              isLoading={loading}
              disabled={otp.length !== 6 || !!success}
            >
              Verify Email
            </LoadingButton>
            
            <button 
              onClick={handleResend}
              disabled={loading || !!success}
              className="w-full text-sm text-gray-400 hover:text-white transition-colors"
            >
              Didn't receive the code? Resend
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}
          
          {success && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm text-center">
              {success}
            </div>
          )}
        </div>
      </AuthCard>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030712]" />}>
      <VerifyForm />
    </Suspense>
  );
}
