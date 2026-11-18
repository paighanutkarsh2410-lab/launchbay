import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, Copy, ExternalLink, GitBranch, PowerOff, RotateCcw, Rocket, X } from "lucide-react";
import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Burst } from "@/components/Burst";
import { CloudPanel } from "@/components/Cloud";
import { DecommissionDialog } from "@/components/DecommissionDialog";
import { ExplainPanel } from "@/components/Explain";
import { MagneticButton } from "@/components/MagneticButton";
import { ScorecardPanel } from "@/components/Scorecard";
import { StatusBadge } from "@/components/StatusDot";
import { TemplateIcon } from "@/components/TemplateIcon";
import { api, type Step } from "@/lib/api";
import { duration } from "@/lib/format";
import { STAGES, stageByKey } from "@/lib/stages";
import { useLaunchStream } from "@/lib/useLaunchStream";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** The rocket's flight across all six stages. */
function Trajectory({ steps, failed }: { steps: Step[]; failed: boolean }) {
  const done = steps.filter((s) => s.status === "succeeded").length;
  const running = steps.some((s) => s.status === "running");
  // Before the first snapshot there are no steps; 0/0 would poison the spring with NaN.
  const progress = steps.length ? Math.min(1, (done + (running ? 0.5 : 0)) / steps.length) : 0;
  const spring = useSpring(progress, { stiffness: 60, damping: 18 });
  useEffect(() => spring.set(progress), [progress, spring]);
  const left = useTransform(spring, (v) => `${v * 100}%`);

  return (
    <div className="panel px-6 pb-6 pt-7 sm:px-10">
      <div className="relative h-14">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/[0.06]" />
        <motion.div
          className={clsx(
            "absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full",
            failed ? "bg-rose" : "bg-gradient-to-r from-violet via-cyan to-mint",
          )}
          style={{ width: left }}
        />
        {steps.map((step, i) => {
          const pos = `${((i + 0.5) / steps.length) * 100}%`;
          return (
            <div key={step.key} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos }}>
              <motion.span
                animate={{
                  scale: step.status === "running" ? 1.25 : 1,
                  backgroundColor:
                    step.status === "succeeded" ? "#34d399" : step.status === "failed" ? "#fb7185" : step.status === "running" ? "#a594ff" : "#2c3249",
                }}
                className="block size-3 rounded-full ring-4 ring-ink-900"
              />
            </div>
          );
        })}
        <motion.div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left }}>
          <motion.div
            animate={failed ? { rotate: 120, y: 6 } : { rotate: 45, y: [0, -3, 0] }}
            transition={failed ? { duration: 0.6 } : { y: { duration: 0.8, repeat: Infinity } }}
            className={clsx(
              "flex size-10 items-center justify-center rounded-full border shadow-[0_0_30px_-4px_var(--color-violet)]",
              failed ? "border-rose/40 bg-rose/20 text-rose" : "border-violet/40 bg-ink-800 text-fg",
            )}
          >
            <Rocket size={18} />
          </motion.div>
        </motion.div>
      </div>
      <div className="mt-3 grid text-center text-[11px] text-faint" style={{ gridTemplateColumns: `repeat(${steps.length || 1}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <span key={s.key} className={clsx("truncate px-1", s.status === "running" && "text-violet-soft", s.status === "succeeded" && "text-muted")}>
            {stageByKey[s.key]?.title ?? s.title}
          </span>
        ))}
      </div>
    </div>
  );
}

function StepNode({ step, last, selected, onSelect, now }: { step: Step; last: boolean; selected: boolean; onSelect: () => void; now: number }) {
  const Icon = stageByKey[step.key]?.icon ?? Check;
  const { status } = step;
  return (
    <button onClick={onSelect} className="group relative flex w-full gap-4 text-left">
      {!last && (
        <span className="absolute left-[23px] top-12 h-[calc(100%-2.25rem)] w-px bg-white/[0.07]">
          <motion.span
            className="absolute inset-x-0 top-0 origin-top bg-gradient-to-b from-mint to-violet"
            initial={false}
            animate={{ scaleY: status === "succeeded" ? 1 : 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{ height: "100%" }}
          />
        </span>
      )}
      <span className="relative flex size-12 shrink-0 items-center justify-center">
        {status === "running" && (
          <motion.span
            className="absolute inset-0 rounded-2xl"
            style={{ background: "conic-gradient(from 0deg, transparent 0 60%, #a594ff, #22d3ee)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        )}
        <span
          className={clsx(
            "absolute inset-[2px] rounded-[14px] border transition-colors duration-300",
            status === "pending" && "border-white/[0.07] bg-ink-850",
            status === "running" && "border-transparent bg-ink-850",
            status === "succeeded" && "border-mint/30 bg-mint/10",
            status === "failed" && "border-rose/30 bg-rose/10",
          )}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={{ scale: 0.3, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="relative"
          >
            {status === "succeeded" ? (
              <Check size={19} className="text-mint" strokeWidth={2.6} />
            ) : status === "failed" ? (
              <X size={19} className="text-rose" strokeWidth={2.6} />
            ) : (
              <Icon size={19} className={status === "running" ? "text-violet-soft" : "text-faint"} />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span
        className={clsx(
          "mb-5 min-w-0 flex-1 rounded-xl px-3 py-2 transition-colors",
          selected ? "bg-white/[0.05]" : "group-hover:bg-white/[0.025]",
        )}
      >
        <span className="flex items-center justify-between gap-3">
          <span className={clsx("font-medium", status === "pending" ? "text-faint" : "text-fg")}>{step.title}</span>
          <span className="font-mono text-xs tabular-nums text-faint">
            {step.started_at ? duration(step.started_at, step.finished_at, now) : ""}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted">
          {status === "running" ? <span className="shimmer-text">{step.detail ?? "In progress…"}</span> : (step.detail ?? stageByKey[step.key]?.blurb)}
        </span>
      </span>
    </button>
  );
}

function Terminal({ step, running }: { step: Step | undefined; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = step?.logs ?? [];
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="panel flex h-full min-h-[420px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <span className="size-3 rounded-full bg-rose/70" />
        <span className="size-3 rounded-full bg-amber/70" />
        <span className="size-3 rounded-full bg-mint/70" />
        <span className="ml-3 font-mono text-xs text-faint">{step ? `launch › ${step.key}` : "launch"}</span>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto bg-ink-950/60 p-4 font-mono text-[12.5px] leading-6">
        <AnimatePresence initial={false}>
          {lines.map((line, i) => (
            <motion.div
              key={`${step?.key}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className={clsx("whitespace-pre-wrap break-all", line.startsWith("✗") ? "text-rose" : "text-muted")}
            >
              <span className="mr-3 select-none text-faint">{String(i + 1).padStart(2, "0")}</span>
              {line}
            </motion.div>
          ))}
        </AnimatePresence>
        {running && <span className="mt-1 inline-block h-4 w-2 animate-pulse bg-violet-soft align-middle" />}
        {!lines.length && !running && <p className="text-faint">Waiting for this stage…</p>}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-fg"
      aria-label="Copy URL"
    >
      {copied ? <Check size={15} className="text-mint" /> : <Copy size={15} />}
    </button>
  );
}

export function ServiceView() {
  const { name } = useParams();
  const { data: service, error } = useQuery({ queryKey: ["service", name], queryFn: () => api.service(name!), enabled: !!name });
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const queryClient = useQueryClient();
  const stream = useLaunchStream(name, service?.launch?.id);
  const [decommissioning, setDecommissioning] = useState(false);
  const retry = useMutation({
    mutationFn: () => api.retry(name!),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["service", name] }),
  });
  const launch = stream.launch ?? service?.launch ?? null;
  const steps = useMemo(() => launch?.steps ?? [], [launch]);
  const running = launch?.status === "running";
  const now = useNow(running);
  const [selected, setSelected] = useState<string | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const wasRunning = useRef(false);

  const current = steps.find((s) => s.status === "running") ?? [...steps].reverse().find((s) => s.status !== "pending");
  const shown = steps.find((s) => s.key === (selected ?? current?.key));

  const cloudDone = steps.find((s) => s.key === "cloud")?.status === "succeeded";
  useEffect(() => {
    if (cloudDone) void queryClient.invalidateQueries({ queryKey: ["service", name] });
  }, [cloudDone, name, queryClient]);

  useEffect(() => {
    if (running) wasRunning.current = true;
    if (wasRunning.current && launch?.status === "succeeded") setJustFinished(true);
  }, [running, launch?.status]);

  if (error) {
    return (
      <div className="panel mx-auto max-w-md p-10 text-center">
        <p className="font-display text-xl">No service called “{name}”</p>
        <Link to="/services" className="mt-4 inline-flex items-center gap-1 text-sm text-violet-soft">
          <ArrowLeft size={14} /> Back to the catalog
        </Link>
      </div>
    );
  }

  const template = templates.find((t) => t.id === service?.template_id);
  const retired = service?.status === "decommissioned";
  const status = retired
    ? "decommissioned"
    : launch?.status === "succeeded"
      ? "live"
      : launch?.status === "failed"
        ? "failed"
        : (service?.status ?? "launching");
  const failedStep = steps.find((s) => s.status === "failed");
  const url = stream.url ?? service?.url;
  const repoUrl = stream.repoUrl ?? service?.repo_url;

  return (
    <div className="space-y-6">
      <Link to="/services" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg">
        <ArrowLeft size={15} /> Catalog
      </Link>

      <div className="flex flex-wrap items-center gap-5">
        {template && <TemplateIcon id={template.id} accent={template.accent} size={56} />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-3xl tracking-tight">{name}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {template?.name ?? "…"} · owned by {service?.owner ?? "…"}
            {launch && <> · {duration(launch.started_at, launch.finished_at, now)}</>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {status === "failed" && failedStep && (
            <MagneticButton onClick={() => retry.mutate()} disabled={retry.isPending}>
              <motion.span animate={retry.isPending ? { rotate: -360 } : { rotate: 0 }} transition={retry.isPending ? { duration: 0.8, repeat: Infinity, ease: "linear" } : {}}>
                <RotateCcw size={15} />
              </motion.span>
              Retry from {stageByKey[failedStep.key]?.title ?? failedStep.title}
            </MagneticButton>
          )}
          {(status === "live" || status === "failed") && (
            <MagneticButton
              variant="ghost"
              onClick={() => setDecommissioning(true)}
              className="hover:border-rose/40 hover:text-rose"
            >
              <PowerOff size={15} /> Decommission
            </MagneticButton>
          )}
          {repoUrl && (
            <MagneticButton variant="ghost" onClick={() => window.open(repoUrl, "_blank", "noopener,noreferrer")}>
              <GitBranch size={15} /> Repository <ExternalLink size={13} className="opacity-60" />
            </MagneticButton>
          )}
        </div>
      </div>

      <DecommissionDialog name={name!} open={decommissioning} onClose={() => setDecommissioning(false)} />

      {retired && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel flex items-center gap-4 p-5"
        >
          <span className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.06] text-muted">
            <PowerOff size={20} />
          </span>
          <div>
            <p className="font-display text-lg font-semibold">Retired</p>
            <p className="text-sm text-muted">
              Removed from GitOps and pruned by Argo CD. The repository is archived, read-only, on GitHub.
            </p>
          </div>
        </motion.div>
      )}

      {retry.isError && (
        <p className="flex items-center gap-2 rounded-xl border border-rose/20 bg-rose/10 px-4 py-3 text-sm text-rose">
          <X size={15} /> {retry.error.message}
        </p>
      )}

      <Trajectory steps={steps} failed={launch?.status === "failed"} />

      <AnimatePresence>
        {launch?.status === "succeeded" && url && !retired && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="panel relative flex flex-wrap items-center gap-4 overflow-visible border-mint/20 p-5"
            style={{ background: "linear-gradient(100deg, rgb(52 211 153 / 0.12), rgb(34 211 238 / 0.05) 50%, transparent)" }}
          >
            {justFinished && <Burst />}
            <span className="flex size-11 items-center justify-center rounded-2xl bg-mint/15 text-mint">
              <Check size={22} strokeWidth={2.6} />
            </span>
            <div>
              <p className="font-display text-lg font-semibold">{name} is live</p>
              <p className="text-sm text-muted">Signed, deployed by Argo CD and passing its health check.</p>
            </div>
            <div className="ml-auto flex items-center gap-1 rounded-xl border border-white/10 bg-ink-900/70 py-1 pl-4 pr-1">
              <span className="font-mono text-sm text-fg">{url}</span>
              <CopyButton text={url} />
              <a href={url} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-fg" aria-label="Open service">
                <ExternalLink size={15} />
              </a>
            </div>
          </motion.div>
        )}
        {launch?.status === "failed" && !retired && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, x: [0, -8, 8, -4, 4, 0] }}
            transition={{ duration: 0.6 }}
            className="panel flex items-center gap-4 border-rose/20 p-5"
            style={{ background: "linear-gradient(100deg, rgb(251 113 133 / 0.12), transparent 60%)" }}
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-rose/15 text-rose">
              <X size={22} strokeWidth={2.6} />
            </span>
            <div>
              <p className="font-display text-lg font-semibold">Launch failed</p>
              <p className="text-sm text-muted">{launch.error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {launch?.status === "failed" && !retired && <ExplainPanel key={`explain-${launch.id}`} name={name!} stored={launch.explanation ?? null} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <div className="panel p-5">
          {steps.map((step, i) => (
            <StepNode
              key={step.key}
              step={step}
              last={i === steps.length - 1}
              selected={shown?.key === step.key}
              onSelect={() => setSelected(step.key === selected ? null : step.key)}
              now={now}
            />
          ))}
          {!steps.length && Array.from({ length: STAGES.length }, (_, i) => <div key={i} className="mb-5 h-14 animate-pulse rounded-xl bg-white/[0.03]" />)}
        </div>
        <Terminal step={shown} running={shown?.status === "running"} />
      </div>

      {service && !retired && <CloudPanel service={service} provisioning={running} />}

      {!retired && !running && launch && <ScorecardPanel key={`score-${launch.id}`} name={name!} />}
    </div>
  );
}
