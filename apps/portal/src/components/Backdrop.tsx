import { motion, useReducedMotion } from "motion/react";

const blobs = [
  { color: "var(--color-violet)", size: 620, x: ["-10%", "8%", "-4%"], y: ["-20%", "-6%", "-14%"], left: "8%", top: "-10%", opacity: 0.22 },
  { color: "var(--color-cyan)", size: 520, x: ["6%", "-8%", "4%"], y: ["10%", "-4%", "6%"], left: "62%", top: "-14%", opacity: 0.14 },
  { color: "var(--color-ember)", size: 420, x: ["0%", "10%", "-6%"], y: ["0%", "8%", "-4%"], left: "40%", top: "70%", opacity: 0.08 },
];

/** Fixed page background: drifting aurora, a fading dot grid and film grain. */
export function Backdrop() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {blobs.map((blob, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: blob.size,
            height: blob.size,
            left: blob.left,
            top: blob.top,
            opacity: blob.opacity,
            background: `radial-gradient(circle at center, ${blob.color}, transparent 65%)`,
            filter: "blur(40px)",
          }}
          animate={reduce ? undefined : { x: blob.x, y: blob.y }}
          transition={{ duration: 22 + i * 6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%)",
        }}
      />
      <div className="noise absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-ink-950 to-transparent" />
    </div>
  );
}
