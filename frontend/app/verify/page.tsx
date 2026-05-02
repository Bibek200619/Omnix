import { AuthCard } from "@/components/auth/AuthCard";
import { VerifyForm } from "@/components/auth/VerifyForm";

export default function VerifyPage() {
  return (
    <AuthCard
      title="Verify your email"
      description="Enter the six-digit code sent to your inbox."
    >
      <VerifyForm />
    </AuthCard>
  );
}
