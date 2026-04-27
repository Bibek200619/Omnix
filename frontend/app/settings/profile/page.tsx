"use client";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageTransition } from "@/components/layout/PageTransition";
import { ArrowLeft, Save, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function ProfilePage() {
  const [name, setName] = useState("Alex Developer");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setIsSuccess(false);

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
    }, 1500);
  };

  return (
    <AppLayout>
      <PageTransition>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="flex items-center gap-4">
              <Link href="/settings" className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Edit Profile</h1>
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-2xl p-6">
              <form onSubmit={handleSave} className="space-y-6">
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">Full Name</label>
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">Email Address <span className="text-gray-500 text-xs ml-2">(Read-only)</span></label>
                  <input 
                    type="email" 
                    value="alex@omnix.ai"
                    readOnly
                    className="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-gray-400 cursor-not-allowed focus:outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">New Password</label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                  />
                </div>

                <div className="pt-4 flex items-center justify-between">
                  <div className="text-sm">
                    {isSuccess && (
                      <span className="flex items-center gap-2 text-green-400 animate-in fade-in slide-in-from-left-4">
                        <CheckCircle2 className="w-4 h-4" /> Profile updated
                      </span>
                    )}
                  </div>
                  
                  <button 
                    type="submit" 
                    disabled={isLoading}
                    className="flex items-center gap-2 bg-white text-black hover:bg-gray-200 transition-colors px-6 py-2.5 rounded-xl font-medium text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {isLoading ? "Saving..." : "Save Changes"}
                  </button>
                </div>

              </form>
            </div>
          </div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
