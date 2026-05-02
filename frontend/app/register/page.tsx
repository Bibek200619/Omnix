import { AuthCard } from "@/components/auth/AuthCard";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Register now. Supabase auth can be wired into this flow without changing the screen structure."
    >
      <RegisterForm />
    </AuthCard>
  );
}
