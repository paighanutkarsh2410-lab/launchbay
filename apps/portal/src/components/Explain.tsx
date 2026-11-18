import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BookOpen, CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, type Explanation } from "@/lib/api";

const ease = [0.16, 1, 0.3, 1] as const;
const thinking = ["Reading the stage log…", "Pulling the failed job's output…", "Matching it to the guardrails…", "Writing up a fix…"];

function ThinkingLine() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % thinking.length), 1600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="relative flex size-8 items-center justify-center">
        {[0, 1, 2].map((d) => (
          <motion.span
            key={d}
            className="absolute size-1.5 rounded-full bg-violet-soft"
            animate={{ rotate: 360 }}
            style={{ originX: "16px", originY: "0px", left: 0, top: "50%" }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear", delay: d * 0.18 }}
          />
        ))}
        <Sparkles size={14} className="text-violet-soft" />
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="shimmer-text text-sm"
        >
          {thinking[i]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** Reveals text word by word. */
function Reveal({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(" ");
  return (
    <p className={className}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ delay: delay + i * 0.025, duration: 0.3 }}
        >
          {word}{" "}
        </motion.span>
      ))}
    </p>
  );
}

const confidenceColor = { high: "text-mint", medium: "text-amber", low: "text-faint" };

function Answer({ explanation, onRefresh, refreshing }: { explanation: Explanation; onRefresh: () => void; refreshing: boolean }) {
  const fromModel = explanation.source !== "rules";
  const modelName = explanation.source === "claude" ? "Claude" : "Gemini";
  const words = explanation.summary.split(" ").length;
  const afterSummary = 0.2 + words * 0.025;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={clsx(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1",
            fromModel ? "bg-violet/15 text-violet-soft" : "bg-white/[0.06] text-muted",
          )}
        >
          {fromModel ? <Sparkles size={12} /> : <BookOpen size={12} />}
          {fromModel ? `Explained by ${modelName}${explanation.model ? ` · ${explanation.model}` : ""}` : "Built-in rules"}
        </span>
        <span className={clsx("rounded-full bg-white/[0.04] px-2.5 py-1", confidenceColor[explanation.confidence])}>
          {explanation.confidence} confidence
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-faint transition-colors hover:bg-white/[0.06] hover:text-fg disabled:opacity-50"
        >
          <RotateCcw size={12} /> Explain again
        </button>
      </div>

      <Reveal text={explanation.summary} delay={0.1} className="font-display text-xl font-semibold leading-snug text-fg" />
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: afterSummary, duration: 0.5, ease }}
        className="text-sm leading-relaxed text-muted"
      >
        {explanation.cause}
      </motion.p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-faint">How to fix it</p>
          <ol className="mt-3 space-y-2.5">
            {explanation.fix.map((step, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: afterSummary + 0.2 + i * 0.12, duration: 0.45, ease }}
                className="flex gap-3 text-sm text-fg"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-violet/40 bg-violet/10 font-mono text-[11px] text-violet-soft">
                  {i + 1}
                </span>
                <span className="pt-0.5 leading-snug">{step}</span>
              </motion.li>
            ))}
          </ol>
        </div>
        {explanation.evidence.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: afterSummary + 0.4 }}
          >
            <p className="text-[11px] uppercase tracking-widest text-faint">Evidence</p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-white/[0.06] bg-ink-950/70 px-4 py-3 font-mono text-[12px] leading-relaxed text-rose/90">
              {explanation.evidence.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {line}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </div>
      {explanation.note && (
        <p className="flex items-center gap-2 text-xs text-faint">
          <CircleAlert size={13} /> {explanation.note}
        </p>
      )}
    </motion.div>
  );
}

/** Failed launch: ask for an explanation of what went wrong and how to fix it. */
export function ExplainPanel({ name, stored }: { name: string; stored: Explanation | null }) {
  const { data: assistant } = useQuery({ queryKey: ["assistant"], queryFn: api.assistant, staleTime: Infinity });
  const explain = useMutation({ mutationFn: (refresh: boolean) => api.explain(name, refresh) });
  const explanation = explain.data ?? stored;

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="panel relative overflow-clip p-6"
    >
      {/* A slow violet sweep behind the panel while there is something to ask. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-x-1/2 -top-1/2 h-full"
        style={{ background: "radial-gradient(50% 60% at 50% 50%, rgb(124 92 255 / 0.12), transparent 70%)" }}
        animate={{ x: ["-20%", "20%", "-20%"] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative">
        {!explanation && !explain.isPending && (
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-violet/15 text-violet-soft">
              <Sparkles size={20} />
            </span>
            <div>
              <p className="font-display text-lg font-semibold">Not sure what went wrong?</p>
              <p className="text-sm text-muted">
                {assistant && assistant.source !== "rules"
                  ? `${assistant.source === "claude" ? "Claude" : "Gemini"} reads the stage log and the failed job's output, then tells you what to fix.`
                  : "Launchbay matches the logs against the failures it knows and tells you what to fix."}
              </p>
            </div>
            <motion.button
              type="button"
              onClick={() => explain.mutate(false)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="relative ml-auto overflow-hidden rounded-xl bg-gradient-to-r from-violet to-cyan px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_30px_-10px_var(--color-violet)]"
            >
              <motion.span
                aria-hidden
                className="absolute inset-y-0 w-1/3 bg-white/25 blur-md"
                animate={{ x: ["-150%", "350%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 1 }}
              />
              <span className="relative flex items-center gap-2">
                <Sparkles size={15} /> Explain this failure
              </span>
            </motion.button>
          </div>
        )}
        {explain.isPending && <ThinkingLine />}
        {explain.isError && !explain.isPending && (
          <p className="flex items-center gap-2 text-sm text-rose">
            <CircleAlert size={15} /> {explain.error.message}
          </p>
        )}
        {explanation && !explain.isPending && (
          <Answer explanation={explanation} onRefresh={() => explain.mutate(true)} refreshing={explain.isPending} />
        )}
      </div>
    </motion.section>
  );
}
