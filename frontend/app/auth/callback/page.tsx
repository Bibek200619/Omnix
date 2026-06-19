import type { Metadata } from "next";
import { OAuthCallbackClient } from "@/components/auth/OAuthCallbackClient";

export const metadata: Metadata = {
  title: "Completing secure sign-in | Omnix",
  description: "Complete OAuth authentication and restore your Omnix workspace session.",
};

export default function OAuthCallbackPage() {
  return <OAuthCallbackClient />;
}
