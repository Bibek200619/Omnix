"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    console.log("[LoginForm] Submitting auth credentials...");
    
    // Simulate API call
    setTimeout(() => {
      // Simulate fake error occasionally or just redirect
      if (Math.random() < 0.1) {
        setLoading(false);
        setError("Invalid email or password. Please try again.");
        console.error("[LoginForm] Authentication failed");
      } else {
        setLoading(false);
        console.log("[LoginForm] Authentication successful. Redirecting to /chat...");
        router.push("/chat");
      }
    }, 1500);
  };

  return (
    <div className="glass-panel p-8 md:p-12 w-full max-w-md relative z-10">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">Welcome Back</h2>
        <p className="text-gray-400">Log in to your Omnix account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
          <Input 
            type="email" 
            required
            placeholder="you@example.com"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
          <Input 
            type="password" 
            required
            placeholder="••••••••"
          />
        </div>

        <Button 
          type="submit" 
          variant="primary" 
          className="w-full mt-2" 
          isLoading={loading}
        >
          Sign In
        </Button>
      </form>

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      <div className="mt-6 text-center text-gray-400 text-sm">
        Don't have an account?{" "}
        <Link href="/auth/register" className="text-purple-400 hover:text-purple-300 transition-colors font-medium">
          Create one
        </Link>
      </div>
    </div>
  );
}
