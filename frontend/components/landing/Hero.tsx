"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden pt-20 pb-16">
      {/* Background blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full mix-blend-screen filter blur-[100px] animate-pulse" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full mix-blend-screen filter blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
      
      <div className="container px-4 mx-auto text-center z-10 relative">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6"
        >
          Your Personal AI Engine <br />
          <span className="text-gradient">No Limits</span>
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-xl md:text-2xl text-gray-400 mb-10 max-w-2xl mx-auto"
        >
          A backend-powered RAG system that brings your documents to life. Chat, search, and analyze with complete control.
        </motion.p>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link href="/auth/register" className="px-8 py-4 rounded-full bg-white text-black font-semibold hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto">
            Get Started <ArrowRight className="w-5 h-5" />
          </Link>
          <Link href="/auth/login" className="px-8 py-4 rounded-full border border-gray-700 hover:bg-gray-800 transition-colors font-semibold w-full sm:w-auto">
            Login
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
