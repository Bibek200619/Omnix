import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to continue your Omnix conversations, shared workspaces, source-backed research, and account settings."
      mode="login"
    >
      <LoginForm />
    </AuthCard>
  );
}
