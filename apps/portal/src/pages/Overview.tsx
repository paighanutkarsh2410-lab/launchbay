import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Clock, Rocket } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { Link, useNavigate } from "react-router";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { GlowCard } from "@/components/GlowCard";
import { GuardrailsSection } from "@/components/Guardrails";
import { LaunchPad } from "@/components/LaunchPad";
import { MagneticButton } from "@/components/MagneticButton";
import { StatusBadge } from "@/components/StatusDot";
import { TemplateIcon } from "@/components/TemplateIcon";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { STAGES } from "@/lib/stages";

const rise: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  }),
};

function Headline() {
  const lines = [["Ship", "a", "service"], ["in", "minutes,"]];
  let index = 0;
  return (
    <h1 className="font-display text-[clamp(2.4rem,5.2vw,4.3rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
      {lines.map((line, l) => (
        <span key={l} className="block">
          {line.map((word) => (
            <motion.span key={word} variants={rise} custom={index++} className="mr-[0.24em] inline-block">
              {word}
            </motion.span>
          ))}
          {l === lines.length - 1 && (
            <motion.span variants={rise} custom={index} className="text-gradient inline-block">
              not tickets.
            </motion.span>
          )}
        </span>
      ))}
    </h1>
  );
}

export function Overview() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 5000 });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: api.services, refetchInterval: 5000 });
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const accent = Object.fromEntries(templates.map((t) => [t.id, t.accent]));

  const cards = [
    { label: "Services", value: stats?.services ?? 0, hint: "launched through Launchbay", color: "var(--color-violet)" },
    { label: "Live", value: stats?.live ?? 0, hint: "healthy and serving", color: "var(--color-mint)" },
    { label: "In flight", value: stats?.launching ?? 0, hint: "launching right now", color: "var(--color-cyan)" },
    {
      label: "Median launch",
      value: stats?.median_launch_seconds ?? 0,
      decimals: 1,
      suffix: "s",
      hint: "from request to live URL",
      color: "var(--color-ember)",
    },
  ];

  return (
    <div className="space-y-16">
      {/* Hero */}
      <motion.section initial="hidden" animate="show" className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.span
            variants={rise}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted"
          >
            <span className="size-1.5 rounded-full bg-ember shadow-[0_0_10px_var(--color-ember)]" />
            Internal developer platform
          </motion.span>
          <div className="mt-6">
            <Headline />
          </div>
          <motion.p variants={rise} custom={6} className="mt-6 max-w-lg text-[17px] leading-relaxed text-muted">
            Pick a template and name your service. Launchbay creates the repo, runs a signed and scanned
            pipeline, and lets Argo CD put it live. No tickets, no waiting.
          </motion.p>
          <motion.div variants={rise} custom={7} className="mt-9 flex flex-wrap items-center gap-3">
            <MagneticButton size="lg" onClick={() => navigate("/launch")}>
              <Rocket size={18} /> Launch a service
            </MagneticButton>
            <MagneticButton size="lg" variant="ghost" onClick={() => navigate("/services")}>
              Browse catalog <ArrowRight size={16} />
            </MagneticButton>
          </motion.div>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <LaunchPad />
        </motion.div>
      </motion.section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, i) => (
          <GlowCard
            key={card.label}
            glow={card.color}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.07, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="p-5"
          >
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="size-1.5 rounded-full" style={{ background: card.color, boxShadow: `0 0 12px ${card.color}` }} />
              {card.label}
            </div>
            <AnimatedNumber
              value={card.value}
              decimals={card.decimals}
              suffix={card.suffix}
              className="mt-3 block font-display text-4xl font-semibold tracking-tight"
            />
            <p className="mt-1 text-xs text-faint">{card.hint}</p>
          </GlowCard>
        ))}
      </section>

      {/* How a launch works */}
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">The launch</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">Seven stages, fully automated</h2>
          </div>
        </div>
        <div className="relative mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <motion.div
            aria-hidden
            className="absolute left-0 right-0 top-[34px] hidden h-px origin-left bg-gradient-to-r from-violet via-cyan to-ember lg:block"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          />
          {STAGES.map((stage, i) => (
            <motion.div
              key={stage.key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.15 + i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <div className="relative z-10 flex size-[68px] items-center justify-center rounded-2xl border border-white/10 bg-ink-850 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                <stage.icon size={24} className="text-violet-soft" />
                <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-white/10 bg-ink-800 font-mono text-[10px] text-muted">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-4 font-display text-[15px] font-semibold">{stage.title}</h3>
              <p className="mt-1 text-sm leading-snug text-muted">{stage.blurb}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <GuardrailsSection />

      {/* Recent launches */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Activity</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">Recent launches</h2>
          </div>
          <Link to="/services" className="flex items-center gap-1 text-sm text-muted transition-colors hover:text-fg">
            View all <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="panel mt-6 divide-y divide-white/[0.05] overflow-hidden">
          {services.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="font-display text-lg">Nothing launched yet</p>
              <p className="max-w-sm text-sm text-muted">Your first service is about two minutes away.</p>
              <MagneticButton className="mt-2" onClick={() => navigate("/launch")}>
                <Rocket size={16} /> Launch the first one
              </MagneticButton>
            </div>
          )}
          {services.slice(0, 6).map((service, i) => (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link
                to={`/services/${service.name}`}
                className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.025]"
              >
                <TemplateIcon id={service.template_id} accent={accent[service.template_id] ?? "#7c5cff"} size={38} />
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-fg">{service.name}</p>
                  <p className="truncate text-xs text-faint">{service.owner}</p>
                </div>
                <span className="ml-auto hidden items-center gap-1.5 text-xs text-faint sm:flex">
                  <Clock size={13} /> {timeAgo(service.created_at)}
                </span>
                <StatusBadge status={service.status} />
                <ArrowRight size={16} className="text-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:text-fg" />
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
