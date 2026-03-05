"use client";
import { ButtonHTMLAttributes, forwardRef } from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "disabled" | "children"> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, disabled, children, ...props }, ref) => {
    const variants = {
      primary: "bg-white text-black hover:bg-gray-200 border border-transparent shadow-[0_0_20px_rgba(255,255,255,0.1)]",
      secondary: "bg-gradient-to-r from-purple-600 to-blue-500 text-white hover:opacity-90 shadow-lg",
      outline: "border border-gray-700 hover:bg-gray-800 text-white",
      ghost: "hover:bg-white/10 text-gray-300 hover:text-white"
    };

    const sizes = {
      sm: "px-4 py-2 text-sm rounded-lg",
      md: "px-6 py-3 rounded-xl",
      lg: "px-8 py-4 text-lg rounded-xl",
      icon: "p-2 rounded-xl"
    };

    const isDisabled = disabled || isLoading;

    return (
      <motion.button
        ref={ref}
        whileHover={isDisabled ? {} : { scale: 1.02, y: -1 }}
        whileTap={isDisabled ? {} : { scale: 0.98 }}
        disabled={isDisabled}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition-colors relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-[#030712]",
          variants[variant],
          sizes[size],
          isDisabled && "opacity-60 cursor-not-allowed",
          className
        )}
        {...(props as any)}
      >
        {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin absolute" />}
        <span className={cn("flex items-center justify-center gap-2", isLoading && "opacity-0")}>
          {children}
        </span>
      </motion.button>
    );
  }
);
Button.displayName = "Button";
