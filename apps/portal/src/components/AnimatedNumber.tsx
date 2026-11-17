import { animate, useInView, useMotionValue, useReducedMotion, useTransform, motion } from "motion/react";
import { useEffect, useRef } from "react";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}

/** Counts up to its value the first time it scrolls into view, then eases between values. */
export function AnimatedNumber({ value, decimals = 0, suffix = "", className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const count = useMotionValue(0);
  const text = useTransform(count, (v) => `${v.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [count, inView, reduce, value]);

  return <motion.span ref={ref} className={className}>{text}</motion.span>;
}
