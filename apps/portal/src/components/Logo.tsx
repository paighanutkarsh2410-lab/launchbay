import { motion } from "motion/react";
import { useId } from "react";

export function LogoMark({ size = 30 }: { size?: number }) {
  // Unique per instance: a gradient id shared with a hidden copy of the logo renders nothing.
  const gradient = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#10131f" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="17.5" fill="none" stroke="rgb(255 255 255 / 0.1)" />
      <path d="M32 11c8 6 12 15 12 24l-6 7H26l-6-7c0-9 4-18 12-24z" fill={`url(#${gradient})`} />
      <circle cx="32" cy="28" r="4.5" fill="#10131f" />
      <motion.path
        d="M27 46h10l-5 9z"
        fill="#ff7a45"
        animate={{ scaleY: [1, 1.35, 0.9, 1.2, 1], opacity: [0.9, 1, 0.8, 1, 0.9] }}
        style={{ transformOrigin: "32px 46px" }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className={compact ? "sr-only sm:not-sr-only sm:font-display sm:text-[17px] sm:font-semibold sm:tracking-tight" : "font-display text-[17px] font-semibold tracking-tight"}>
        Launchbay
      </span>
    </span>
  );
}
