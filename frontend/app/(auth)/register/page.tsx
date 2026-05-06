import { AuthCard } from "@/components/auth/AuthCard";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Create a Supabase-backed Omnix account for your AI workspace."
    >
      <RegisterForm />
    </AuthCard>
  );
}
