"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { OTPInput } from "@/components/ui/OTPInput";

export function VerifyForm() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otp.length !== 6) return;
    setLoading(true);

    window.setTimeout(() => {
      setLoading(false);
      router.push("/chat");
    }, 500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
