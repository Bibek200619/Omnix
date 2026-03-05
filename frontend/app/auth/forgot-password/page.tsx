"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);

      if (error) throw error;

      // Redirect to reset password page to enter OTP and new password
      router.push(`/auth/reset-password?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      setError(err.message || "Failed to send reset email. Please try again.");
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
        title="Reset Password"
        description="Enter your email address to receive a verification code."
        backLink={{ href: "/auth/login", label: "Back to login" }}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
            <Input 
              type="email" 
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <LoadingButton 
            type="submit" 
            className="w-full" 
            isLoading={loading}
          >
            Send Reset Code
          </LoadingButton>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}
      </AuthCard>
    </div>
  );
}
