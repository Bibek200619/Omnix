import { AuthCard } from "@/components/auth/AuthCard";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Create an Omnix account for collaborative AI research, uploads, web search, and team knowledge."
      mode="register"
    >
      <RegisterForm />
    </AuthCard>
  );
}
