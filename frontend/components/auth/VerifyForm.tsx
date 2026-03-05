"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { OTPInput } from "@/components/ui/OTPInput";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Button } from "@/components/ui/Button";

export function VerifyForm() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (code.length !== 6) {
      return;
    }

    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    router.push("/chat");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="mb-3 block text-sm font-medium text-stone-200">Verification code</label>
        <OTPInput value={code} onChange={setCode} disabled={loading} />
      </div>
      <LoadingButton
        type="submit"
        fullWidth
        loading={loading}
        loadingText="Verifying"
        disabled={code.length !== 6}
      >
        Verify
      </LoadingButton>
      <Button type="button" variant="ghost" fullWidth onClick={() => setCode("")} disabled={!code || loading}>
        Clear code
      </Button>
    </form>
  );
}
