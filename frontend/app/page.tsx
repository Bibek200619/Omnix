import { About } from "@/components/landing/About";
import { CTA } from "@/components/landing/CTA";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Features />
      <About />
      <CTA />
      <Footer />
    </>
  );
}
