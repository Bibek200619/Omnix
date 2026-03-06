import { AuthCard } from "@/components/auth/AuthCard";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Register with Supabase and continue into your Omnix workspace."
    >
      <RegisterForm />
    </AuthCard>
  );
}
