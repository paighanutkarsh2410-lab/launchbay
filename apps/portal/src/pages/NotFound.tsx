import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { MagneticButton } from "@/components/MagneticButton";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <motion.p
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="font-display text-[120px] font-semibold leading-none text-gradient"
      >
        404
      </motion.p>
      <p className="mt-4 text-lg text-muted">This page drifted out of orbit.</p>
      <MagneticButton className="mt-8" onClick={() => navigate("/")}>
        Back to mission control
      </MagneticButton>
    </div>
  );
}
