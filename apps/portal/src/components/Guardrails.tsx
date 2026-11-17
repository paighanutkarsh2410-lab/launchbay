import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, HeartPulse, Lock, Package, ShieldCheck, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { GlowCard } from "./GlowCard";

const look: Record<string, { icon: LucideIcon; color: string }> = {
  "launchbay-require-signed-images": { icon: BadgeCheck, color: "#34d399" },
  "launchbay-restrict-registries": { icon: Package, color: "#22d3ee" },
  "launchbay-pod-security": { icon: Lock, color: "#a594ff" },
  "launchbay-require-operability": { icon: HeartPulse, color: "#ff7a45" },
};

/** The four Kyverno guardrails every launched service is admitted through. */
export function GuardrailsSection() {
  const { data: guardrails = [] } = useQuery({ queryKey: ["guardrails"], queryFn: api.guardrails, staleTime: Infinity });

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Guardrails</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            Every launch passes {["no", "one", "two", "three", "four", "five", "six"][guardrails.length] ?? guardrails.length} guardrails
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Enforced by Kyverno when Kubernetes admits a workload. A service that breaks one never runs, and the
            launch says exactly which rule it broke.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-mint/20 bg-mint/10 px-3 py-1.5 text-xs text-mint">
          <ShieldCheck size={14} /> Enforcing
        </span>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {guardrails.map((g, i) => {
          const { icon: Icon, color } = look[g.name] ?? { icon: ShieldCheck, color: "#a594ff" };
          return (
            <GlowCard
              key={g.name}
              glow={color}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="p-6"
            >
              <div className="flex items-start gap-4">
                <motion.span
                  className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
                  initial={{ rotate: -12, scale: 0.8 }}
                  whileInView={{ rotate: 0, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 260, damping: 14 }}
                >
                  <Icon size={22} />
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-2xl"
                    style={{ boxShadow: `0 0 0 1px ${color}` }}
                    animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.18, 1] }}
                    transition={{ duration: 3, repeat: Infinity, delay: i * 0.6 }}
                  />
                </motion.span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-[17px] font-semibold">{g.title}</h3>
                    <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-faint">
                      {g.kind}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{g.summary}</p>
                </div>
              </div>
              <ul className="mt-5 space-y-2 border-t border-white/[0.06] pt-4">
                {g.rules.map((rule, r) => (
                  <motion.li
                    key={rule}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.08 + r * 0.07 }}
                    className="flex items-start gap-2.5 text-[13px] leading-snug text-muted"
                  >
                    <Check size={14} className="mt-0.5 shrink-0" style={{ color }} />
                    {rule}
                  </motion.li>
                ))}
              </ul>
            </GlowCard>
          );
        })}
        {!guardrails.length && Array.from({ length: 4 }, (_, i) => <div key={i} className="panel h-56 animate-pulse" />)}
      </div>
    </section>
  );
}

/** A compact list of the guardrails for the launch review step. */
export function GuardrailChecklist() {
  const { data: guardrails = [] } = useQuery({ queryKey: ["guardrails"], queryFn: api.guardrails, staleTime: Infinity });
  if (!guardrails.length) return null;
  return (
    <div className="mt-6 rounded-2xl border border-white/[0.06] bg-ink-900/60 p-4">
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-faint">
        <ShieldCheck size={13} /> Checked at deploy
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {guardrails.map((g, i) => {
          const { icon: Icon, color } = look[g.name] ?? { icon: ShieldCheck, color: "#a594ff" };
          return (
            <motion.li
              key={g.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.08 }}
              className="flex items-center gap-2 text-sm text-fg"
            >
              <Icon size={15} style={{ color }} /> {g.title}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
