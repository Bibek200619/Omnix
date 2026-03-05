import Link from "next/link";

export function Footer() {
  return (
    <footer className="py-12 border-t border-white/5 bg-black/80 backdrop-blur-md">
      <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-2xl font-bold text-white tracking-tighter">
          Omnix<span className="text-purple-500">.</span>
        </div>
        <div className="flex gap-8 text-gray-400 text-sm">
          <Link href="#" className="hover:text-white transition-colors">Privacy</Link>
          <Link href="#" className="hover:text-white transition-colors">Terms</Link>
          <Link href="#" className="hover:text-white transition-colors">Contact</Link>
          <Link href="#" className="hover:text-white transition-colors">GitHub</Link>
        </div>
        <div className="text-gray-500 text-sm">
          © {new Date().getFullYear()} Omnix. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
