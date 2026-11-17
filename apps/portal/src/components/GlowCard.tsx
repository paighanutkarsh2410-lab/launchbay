import clsx from "clsx";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, type HTMLMotionProps } from "motion/react";
import type { PointerEvent, ReactNode } from "react";

interface GlowCardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  /** Spotlight color under the cursor. */
  glow?: string;
  /** Tilt the card toward the cursor in 3D. */
  tilt?: boolean;
  className?: string;
}

/** A glass panel with a cursor-following spotlight and optional 3D tilt. */
export function GlowCard({ children, glow = "var(--color-violet)", tilt = false, className, style, ...rest }: GlowCardProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const rotateX = useSpring(0, { stiffness: 200, damping: 20 });
  const rotateY = useSpring(0, { stiffness: 200, damping: 20 });
  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${x}px ${y}px, color-mix(in oklab, ${glow} 22%, transparent), transparent 60%)`;
  const rim = useMotionTemplate`radial-gradient(260px circle at ${x}px ${y}px, color-mix(in oklab, ${glow} 70%, transparent), transparent 70%)`;

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    x.set(px);
    y.set(py);
    if (tilt && !reduce) {
      rotateY.set(((px / rect.width) - 0.5) * 10);
      rotateX.set(-((py / rect.height) - 0.5) * 10);
    }
  }

  function onLeave() {
    x.set(-400);
    y.set(-400);
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <motion.div
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={clsx("panel group", className)}
      style={{ ...style, rotateX, rotateY, transformPerspective: 900 }}
      {...rest}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: spotlight }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: rim,
          padding: 1,
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude",
        }}
      />
      {children}
    </motion.div>
  );
}
