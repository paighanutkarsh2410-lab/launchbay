import clsx from "clsx";
import { motion, useReducedMotion, useSpring, type HTMLMotionProps } from "motion/react";
import type { PointerEvent, ReactNode } from "react";

interface MagneticButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children: ReactNode;
  variant?: "primary" | "ghost";
  size?: "md" | "lg";
}

/** A button that leans toward the cursor, with a light sweep across primary buttons. */
export function MagneticButton({ children, variant = "primary", size = "md", className, disabled, ...rest }: MagneticButtonProps) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 260, damping: 18 });
  const y = useSpring(0, { stiffness: 260, damping: 18 });

  function onMove(event: PointerEvent<HTMLButtonElement>) {
    if (reduce || disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - rect.left - rect.width / 2) * 0.22);
    y.set((event.clientY - rect.top - rect.height / 2) * 0.3);
  }

  return (
    <motion.button
      onPointerMove={onMove}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      style={{ x, y }}
      disabled={disabled}
      className={clsx(
        "group relative inline-flex select-none items-center justify-center gap-2 overflow-hidden rounded-full font-medium tracking-tight transition-[box-shadow,opacity,background-color] duration-300 disabled:cursor-not-allowed disabled:opacity-40",
        size === "lg" ? "h-13 px-7 text-[15px]" : "h-10 px-5 text-sm",
        variant === "primary"
          ? "bg-gradient-to-r from-violet to-[#5b8cff] text-white shadow-[0_8px_30px_-6px_rgb(124_92_255/0.65),inset_0_1px_0_rgb(255_255_255/0.25)] hover:shadow-[0_12px_44px_-6px_rgb(124_92_255/0.85),inset_0_1px_0_rgb(255_255_255/0.3)]"
          : "border border-white/10 bg-white/[0.04] text-fg hover:bg-white/[0.08]",
        className,
      )}
      {...rest}
    >
      {variant === "primary" && (
        <span
          aria-hidden
          className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </motion.button>
  );
}
