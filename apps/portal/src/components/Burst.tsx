import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

const palette = ["#7c5cff", "#22d3ee", "#ff7a45", "#34d399", "#fbbf24", "#ffffff"];

/** A one-shot particle burst from the center of its parent. Re-mount (change `key`) to replay. */
export function Burst({ count = 46 }: { count?: number }) {
  const reduce = useReducedMotion();
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const distance = 90 + Math.random() * 170;
        return {
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          size: 3 + Math.random() * 5,
          color: palette[i % palette.length],
          delay: Math.random() * 0.12,
          round: Math.random() > 0.4,
        };
      }),
    [count],
  );
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20">
      {particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{ width: p.size, height: p.size, background: p.color, borderRadius: p.round ? 999 : 2 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y + 40, opacity: 0, scale: 0.4, rotate: 180 }}
          transition={{ duration: 1.3, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </div>
  );
}
