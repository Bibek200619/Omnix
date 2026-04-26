"use client";
import { motion } from "framer-motion";
import Link from "next/link";

export function CTA() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-purple-900/10" />
      <div className="container mx-auto px-4 relative z-10">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="glass-panel p-12 md:p-24 text-center max-w-5xl mx-auto relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl" />
          
          <div className="relative z-10">
            <h2 className="text-4xl md:text-6xl font-bold mb-6">Start using AI without limits</h2>
            <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">Join thousands of users building the next generation of intelligent applications today.</p>
            <Link href="/auth/register" className="inline-block px-10 py-4 rounded-full bg-white text-black font-semibold hover:bg-gray-200 transition-all hover:scale-105 shadow-[0_0_40px_rgba(255,255,255,0.3)]">
              Create an Account
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
