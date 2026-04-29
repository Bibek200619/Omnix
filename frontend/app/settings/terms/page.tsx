"use client";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageTransition } from "@/components/layout/PageTransition";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";

export default function TermsPage() {
  const [accepted, setAccepted] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const router = useRouter();

  const handleContinue = () => {
    if (!accepted) return;
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      router.push("/settings");
    }, 1500);
  };

  return (
    <AppLayout>
      <PageTransition>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Terms & Conditions</h1>
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-2xl overflow-hidden flex flex-col h-[60vh]">
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar text-sm text-gray-300 leading-relaxed">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">1. Introduction</h3>
                  <p>Welcome to Omnix. By accessing or using our AI services, you agree to be bound by these terms. We provide an advanced conversational AI model and related infrastructure intended for productivity, research, and analysis.</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">2. Acceptable Use</h3>
                  <p>You agree not to use the services for any unlawful or prohibited activities. This includes, but is not limited to, generating malicious code, attempting to bypass safety protocols, or violating the privacy rights of others. We reserve the right to suspend accounts that violate these guidelines.</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">3. Data Privacy</h3>
                  <p>Your conversations and data are processed securely. We employ industry-standard encryption. By using Omnix, you consent to our data collection practices as outlined in our Privacy Policy. We do not sell your personal data to third parties.</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">4. Intellectual Property</h3>
                  <p>You retain rights to the input you provide. The generated output may be used by you freely, subject to our restrictions. The underlying models, branding, and platform infrastructure remain the exclusive property of Omnix Inc.</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">5. Limitation of Liability</h3>
                  <p>Our services are provided "as is" without warranty of any kind. We are not liable for any damages arising from your use or inability to use the platform, including inaccuracies in AI-generated content. Always verify critical information.</p>
                </div>
              </div>
              
              <div className="p-6 bg-black/40 border-t border-white/5 space-y-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${accepted ? 'bg-purple-500 border-purple-500' : 'border-gray-500 group-hover:border-purple-400'}`}>
                    {accepted && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <input 
                    type="checkbox" 
                    className="sr-only"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span className="text-sm text-gray-300 select-none">
                    I have read and agree to the Terms & Conditions and Privacy Policy.
                  </span>
                </label>
                
                <div className="flex items-center gap-4 pt-2">
                  <motion.button 
                    whileTap={!accepted ? {} : { scale: 0.95 }}
                    onClick={handleContinue}
                    disabled={!accepted}
                    className="px-6 py-2.5 rounded-xl font-medium text-sm transition-all bg-white text-black hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue
                  </motion.button>
                  {showSuccess && (
                    <motion.span 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-sm text-green-400"
                    >
                      Terms accepted successfully!
                    </motion.span>
                  )}
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
