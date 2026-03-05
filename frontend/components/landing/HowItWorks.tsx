"use client";
import { motion } from "framer-motion";

const steps = [
  { num: "01", title: "Upload Data", desc: "Securely upload your documents, PDFs, or connect your databases." },
  { num: "02", title: "Process with AI", desc: "Our RAG engine indexes and vectorizes your data instantly." },
  { num: "03", title: "Ask Questions", desc: "Query your data using natural language." },
  { num: "04", title: "Get Answers", desc: "Receive accurate, cited answers based purely on your context." }
];

export function HowItWorks() {
  return (
    <section className="py-24 bg-gray-900/30 border-y border-white/5 relative overflow-hidden">
      <div className="container mx-auto px-4 max-w-6xl relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">How It Works</h2>
          <p className="text-gray-400 text-lg">From data to insights in minutes.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="relative p-6 glass-card border-none bg-transparent shadow-none"
            >
              <div className="text-6xl font-black text-white/5 absolute top-0 left-4 -z-10">{step.num}</div>
              <div className="pt-8">
                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
