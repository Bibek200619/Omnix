import { AuthCard } from "@/components/auth/AuthCard";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthCard title="Create your account" subtitle="Register for Omnix and verify your email before entering the app.">
      <RegisterForm />
    </AuthCard>
  );
}
