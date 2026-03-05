"use client";
import { motion } from "framer-motion";

export function About() {
  return (
    <section className="py-32 container mx-auto px-4 relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-purple-900/10 rounded-full blur-[120px] -z-10" />
      <div className="max-w-3xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Built for Control</h2>
          <p className="text-xl text-gray-400 leading-relaxed">
            Omnix isn't just another AI wrapper. It's a comprehensive RAG platform designed to give you 
            complete ownership over your workflows. With our robust backend infrastructure, your queries 
            are grounded in your own reality—free from arbitrary limits.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
