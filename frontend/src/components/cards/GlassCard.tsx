import { motion } from "framer-motion";
import type { ReactNode } from "react";

const glowClass: Record<"cyan" | "green" | "red" | "amber", string> = {
  cyan: "glow-cyan",
  green: "glow-green",
  red: "glow-red",
  amber: "glow-amber",
};

type Glow = keyof typeof glowClass;

export interface GlassCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: Glow;
}

export function GlassCard({ children, className = "", glowColor }: GlassCardProps) {
  const glow = glowColor ? glowClass[glowColor] : "";
  return (
    <motion.div
      className={`glass-card ${glow} ${className}`.trim()}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
