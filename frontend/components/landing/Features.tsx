"use client";
import { motion } from "framer-motion";
import { Zap, Shield, Search, MessageSquare } from "lucide-react";

const features = [
  {
    icon: <Zap className="w-6 h-6 text-yellow-400" />,
    title: "Fast AI Responses",
    description: "Powered by advanced models optimized for lightning-fast latency."
  },
  {
    icon: <Shield className="w-6 h-6 text-green-400" />,
    title: "Private & Secure",
    description: "Your data remains yours. Built with enterprise-grade security."
  },
  {
    icon: <Search className="w-6 h-6 text-blue-400" />,
    title: "Smart Document Search (RAG)",
    description: "Upload your data and instantly get precise, context-aware answers."
  },
  {
    icon: <MessageSquare className="w-6 h-6 text-purple-400" />,
    title: "Chat with Memory",
    description: "Persistent conversations that remember context across sessions."
  }
];

export function Features() {
  return (
    <section className="py-24 relative z-10">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">Powerful Features</h2>
          <p className="text-gray-400 text-lg">Everything you need to build intelligent workflows.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ y: -5 }}
              className="glass-card p-6 transition-all duration-300 hover:border-purple-500/50"
            >
              <div className="w-12 h-12 rounded-xl bg-gray-800/80 flex items-center justify-center mb-6 border border-white/5">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
              <p className="text-gray-400 leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
