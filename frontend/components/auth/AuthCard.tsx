"use client";
import { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";

interface AuthCardProps {
  children: ReactNode;
  title: string;
  description: string;
  backLink?: {
    href: string;
    label: string;
  };
}

export function AuthCard({ children, title, description, backLink }: AuthCardProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel p-8 md:p-12 w-full max-w-md relative z-10 mx-auto"
    >
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2 tracking-tight text-white">{title}</h2>
        <p className="text-gray-400">{description}</p>
      </div>

      {children}

      {backLink && (
        <div className="mt-6 text-center">
          <Link href={backLink.href} className="text-sm text-gray-400 hover:text-white transition-colors">
            {backLink.label}
          </Link>
        </div>
      )}
    </motion.div>
  );
}
