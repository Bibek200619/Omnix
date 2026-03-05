"use client";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageTransition } from "@/components/layout/PageTransition";
import { User, FileText, ChevronRight } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

const SETTING_CARDS = [
  {
    title: "Edit Profile",
    description: "Update your personal information and credentials.",
    icon: User,
    href: "/settings/profile",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
  },
  {
    title: "Terms & Conditions",
    description: "Review our policies and your agreements.",
    icon: FileText,
    href: "/settings/terms",
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
  }
];

export default function SettingsPage() {
  return (
    <AppLayout>
      <PageTransition>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto space-y-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-2">Settings</h1>
              <p className="text-gray-400 text-sm">Manage your account settings and preferences.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SETTING_CARDS.map((card, idx) => (
                <Link key={card.title} href={card.href}>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="group relative p-5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all cursor-pointer overflow-hidden flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl ${card.bgColor} flex items-center justify-center shrink-0`}>
                        <card.icon className={`w-6 h-6 ${card.color}`} />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-gray-200 group-hover:text-white transition-colors">{card.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">{card.description}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors group-hover:translate-x-1" />
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
