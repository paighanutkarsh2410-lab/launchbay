import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Award, CircleCheck, CircleMinus, CircleX, RefreshCw } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Grade, type ScoreCheck, type ScoreSummary } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { gradeColor } from "@/lib/scores";

const categories: ScoreCheck["category"][] = ["Ownership", "Delivery", "Security", "Reliability"];
const ease = [0.16, 1, 0.3, 1] as const;

/** A small grade chip for lists and cards. */
export function GradeChip({ summary }: { summary?: ScoreSummary }) {
  if (!summary) return null;
  const { grade, score } = summary;
  const color = gradeColor[grade];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
      title={`Scorecard: ${score}/100`}
    >
      <Award size={12} /> {grade} · {score}
    </span>
  );
}

/** The score as a ring that fills from empty, with the number counting up in the middle. */
function ScoreRing({ score, grade }: { score: number; grade: Grade }) {
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const text = useTransform(value, (v) => Math.round(v).toString());
  const color = gradeColor[grade];
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = useTransform(value, (v) => circumference * (1 - v / 100));

  useEffect(() => {
    if (reduce) {
      value.set(score);
      return;
    }
    const controls = animate(value, score, { duration: 1.6, ease });
    return () => controls.stop();
  }, [reduce, score, value]);

  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="10" />
        <motion.circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset, filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span className="font-display text-4xl font-semibold tracking-tight">{text}</motion.span>
        <span className="text-[11px] uppercase tracking-widest text-faint">of 100</span>
      </div>
    </div>
  );
}

function CheckRow({ check, index }: { check: ScoreCheck; index: number }) {
  const Icon = check.result === "pass" ? CircleCheck : check.result === "fail" ? CircleX : CircleMinus;
  const color = check.result === "pass" ? "text-mint" : check.result === "fail" ? "text-rose" : "text-faint";
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 + index * 0.04, duration: 0.4, ease }}
      className="flex items-start gap-2.5"
      title={check.description}
    >
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.35 + index * 0.04, type: "spring", stiffness: 400, damping: 15 }}
        className={clsx("mt-0.5 shrink-0", color)}
      >
        <Icon size={16} />
      </motion.span>
      <div className="min-w-0">
        <p className={clsx("text-sm", check.result === "skip" ? "text-muted" : "text-fg")}>{check.title}</p>
        <p className="text-xs text-faint">
          {check.detail}
          {check.result === "fail" && <span className="text-muted"> · {check.remedy}</span>}
        </p>
      </div>
    </motion.li>
  );
}

/** Service page: the scorecard, grouped by category. */
export function ScorecardPanel({ name }: { name: string }) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data: card, isError } = useQuery({
    queryKey: ["scorecard", name],
    queryFn: () => api.scorecard(name),
    staleTime: 60_000,
    retry: false,
  });

  async function recheck() {
    setRefreshing(true);
    try {
      queryClient.setQueryData(["scorecard", name], await api.scorecard(name, true));
      void queryClient.invalidateQueries({ queryKey: ["scorecards"] });
    } finally {
      setRefreshing(false);
    }
  }

  if (isError) return null;
  let index = 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className="panel p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Scorecard</p>
          <h2 className="mt-1 font-display text-lg font-semibold">How this service measures up</h2>
        </div>
        <button
          type="button"
          onClick={() => void recheck()}
          disabled={refreshing || !card}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-white/[0.06] hover:text-fg disabled:opacity-50"
        >
          <motion.span
            animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
            transition={refreshing ? { duration: 0.9, repeat: Infinity, ease: "linear" } : { duration: 0 }}
          >
            <RefreshCw size={13} />
          </motion.span>
          {card ? `Checked ${timeAgo(card.checked_at)}` : "Checking…"}
        </button>
      </div>

      {!card && <div className="mt-6 h-40 animate-pulse rounded-2xl bg-white/[0.03]" />}
      {card && (
        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start">
          <div className="flex items-center gap-5 lg:flex-col lg:items-center">
            <ScoreRing score={card.score} grade={card.grade} />
            <motion.div
              initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ delay: 1.1, type: "spring", stiffness: 260, damping: 14 }}
              className="flex items-center gap-2 rounded-full px-3.5 py-1.5 font-display text-sm font-semibold"
              style={{
                color: gradeColor[card.grade],
                background: `color-mix(in oklab, ${gradeColor[card.grade]} 14%, transparent)`,
                boxShadow: `0 0 30px -8px ${gradeColor[card.grade]}`,
              }}
            >
              <Award size={16} /> {card.grade}
            </motion.div>
          </div>
          <div className="grid flex-1 gap-6 sm:grid-cols-2">
            {categories.map((category) => {
              const checks = card.checks.filter((c) => c.category === category);
              const passed = checks.filter((c) => c.result === "pass").length;
              const counted = checks.filter((c) => c.result !== "skip").length;
              return (
                <div key={category}>
                  <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2">
                    <p className="text-[11px] uppercase tracking-widest text-faint">{category}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {passed}/{counted}
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {checks.map((check) => (
                      <CheckRow key={check.id} check={check} index={index++} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.section>
  );
}

/** Mission control: every launched service ranked by its scorecard. */
export function ScoreBoard() {
  const { data = [] } = useQuery({ queryKey: ["scorecards"], queryFn: api.scorecards, staleTime: 60_000 });
  if (!data.length) return null;
  const ranked = [...data].sort((a, b) => b.score - a.score);
  return (
    <section>
      <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Scorecards</p>
      <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">How the fleet measures up</h2>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Eleven checks across ownership, delivery, security and reliability, read live from GitHub, Argo CD and
        each service's health check.
      </p>
      <div className="panel mt-6 divide-y divide-white/[0.05] overflow-hidden">
        {ranked.map((entry, i) => {
          const color = gradeColor[entry.grade];
          return (
            <Link
              key={entry.service}
              to={`/services/${entry.service}`}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.025]"
            >
              <span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
              <span className="w-36 truncate font-mono text-sm text-fg sm:w-44">{entry.service}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 40%, transparent), ${color})` }}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${entry.score}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 + i * 0.08, duration: 1.1, ease }}
                />
              </div>
              <span className="w-8 text-right font-mono text-sm text-fg">{entry.score}</span>
              <span className="hidden w-32 sm:block">
                <GradeChip summary={entry} />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
