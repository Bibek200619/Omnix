import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Omnix AI",
  description: "A production-ready AI SaaS frontend for RAG chat, auth, history, and settings."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
