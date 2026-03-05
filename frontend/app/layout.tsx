import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Omnix AI",
  description: "A clean AI SaaS frontend for RAG chat, history, and account settings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
