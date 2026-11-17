import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Loader2, Rocket } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Burst } from "@/components/Burst";
import { GlowCard } from "@/components/GlowCard";
import { MagneticButton } from "@/components/MagneticButton";
import { TemplateIcon } from "@/components/TemplateIcon";
import { api, type Template } from "@/lib/api";
import { slugify } from "@/lib/format";

const steps = ["Template", "Details", "Review"] as const;

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-3">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <motion.span
                animate={{
                  backgroundColor: done ? "#7c5cff" : active ? "rgba(124,92,255,0.18)" : "rgba(255,255,255,0.04)",
                  borderColor: done || active ? "rgba(124,92,255,0.8)" : "rgba(255,255,255,0.1)",
                }}
                className="flex size-7 items-center justify-center rounded-full border text-xs"
              >
                {done ? <Check size={14} /> : <span className={active ? "text-fg" : "text-faint"}>{i + 1}</span>}
              </motion.span>
              <span className={clsx("hidden text-sm sm:inline", active ? "text-fg" : "text-faint")}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className="relative h-px w-10 overflow-hidden bg-white/10 sm:w-16">
                <motion.span
                  className="absolute inset-0 origin-left bg-violet"
                  animate={{ scaleX: done ? 1 : 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-fg">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <div className="mt-2 min-h-5 text-xs">{hint}</div>}
    </label>
  );
}

const inputClass =
  "h-12 w-full rounded-xl border border-white/10 bg-ink-900/70 px-4 text-[15px] text-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:border-violet/70 focus:shadow-[0_0_0_4px_rgb(124_92_255/0.15)]";

/** A value that animates in each time it changes. */
function Morph({ value, className }: { value: string; className?: string }) {
  return (
    <span className={clsx("relative inline-flex overflow-hidden", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="block truncate"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Countdown({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n === 0) {
      const id = setTimeout(onDone, 900);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setN(n - 1), 650);
    return () => clearTimeout(id);
  }, [n, onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="relative flex size-72 items-center justify-center">
        <motion.span
          className="absolute inset-0 rounded-full border border-violet/40"
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.2, 0.6] }}
          transition={{ duration: 0.65, repeat: Infinity }}
        />
        <AnimatePresence mode="popLayout">
          <motion.span
            key={n}
            initial={{ scale: 2.2, opacity: 0, filter: "blur(12px)" }}
            animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
            exit={{ scale: 0.4, opacity: 0, filter: "blur(8px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-[120px] font-semibold leading-none text-gradient"
          >
            {n === 0 ? <Rocket size={110} className="text-ember" /> : n}
          </motion.span>
        </AnimatePresence>
        {n === 0 && <Burst key="burst" />}
      </div>
    </motion.div>
  );
}

export function LaunchWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [template, setTemplate] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("team-platform");
  const [description, setDescription] = useState("");
  const [counting, setCounting] = useState(false);
  const [countdownDone, setCountdownDone] = useState(false);

  const { data: templates = [], isLoading } = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const debouncedName = useDebounced(name);
  const nameCheck = useQuery({
    queryKey: ["check-name", debouncedName],
    queryFn: () => api.checkName(debouncedName),
    enabled: debouncedName.length >= 3,
  });
  const create = useMutation({ mutationFn: api.createService });

  const checking = name !== debouncedName || nameCheck.isFetching;
  const nameOk = name.length >= 3 && !checking && nameCheck.data?.available === true;
  const canNext = step === 0 ? !!template : step === 1 ? nameOk && owner.trim().length >= 2 : true;

  useEffect(() => {
    if (countdownDone && create.isSuccess) navigate(`/services/${create.data.name}`);
  }, [countdownDone, create.isSuccess, create.data, navigate]);

  const finishCountdown = useCallback(() => setCountdownDone(true), []);

  function go(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function launch() {
    if (!template) return;
    setCounting(true);
    create.mutate(
      { name, template_id: template.id, owner: owner.trim(), description: description.trim() },
      { onError: () => setCounting(false) },
    );
  }

  const preview = [
    { label: "Repository", value: `launchbay-labs/${name || "your-service"}` },
    { label: "Namespace", value: name || "your-service" },
    { label: "Image", value: `ghcr.io/launchbay-labs/${name || "your-service"}` },
    { label: "URL", value: `http://${name || "your-service"}.localtest.me` },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">New service</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Launch a service</h1>
        </div>
        <Stepper current={step} />
      </div>

      <div className="relative mt-10 min-h-[460px]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 0 && (
              <div className="grid gap-4 md:grid-cols-3">
                {isLoading &&
                  Array.from({ length: 3 }, (_, i) => <div key={i} className="panel h-64 animate-pulse" />)}
                {templates.map((t, i) => {
                  const selected = template?.id === t.id;
                  return (
                    <GlowCard
                      key={t.id}
                      tilt
                      glow={t.accent}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      onClick={() => setTemplate(t)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setTemplate(t)}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                      className="cursor-pointer p-6"
                    >
                      {selected && (
                        <motion.span
                          layoutId="template-ring"
                          className="pointer-events-none absolute -inset-px rounded-[21px]"
                          style={{ boxShadow: `0 0 0 2px ${t.accent}, 0 20px 60px -20px ${t.accent}` }}
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <div className="flex items-start justify-between">
                        <TemplateIcon id={t.id} accent={t.accent} size={52} />
                        <AnimatePresence>
                          {selected && (
                            <motion.span
                              initial={{ scale: 0, rotate: -90 }}
                              animate={{ scale: 1, rotate: 0 }}
                              exit={{ scale: 0 }}
                              className="flex size-7 items-center justify-center rounded-full text-ink-950"
                              style={{ background: t.accent }}
                            >
                              <Check size={15} strokeWidth={3} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                      <h3 className="mt-6 font-display text-xl font-semibold">{t.name}</h3>
                      <p className="mt-1 font-mono text-xs text-faint">{t.runtime}</p>
                      <p className="mt-4 text-sm leading-relaxed text-muted">{t.description}</p>
                      <div className="mt-6 flex flex-wrap gap-1.5">
                        {t.tags.map((tag) => (
                          <span key={tag} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted">
                            {tag}
                          </span>
                        ))}
                        <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-muted">
                          :{t.port}
                        </span>
                      </div>
                    </GlowCard>
                  );
                })}
              </div>
            )}

            {step === 1 && template && (
              <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
                <div className="panel space-y-6 p-7">
                  <Field
                    label="Service name"
                    hint={
                      name.length === 0 ? (
                        <span className="text-faint">Lowercase letters, digits and hyphens. Becomes the repo and namespace.</span>
                      ) : name.length < 3 ? (
                        <span className="text-faint">At least 3 characters.</span>
                      ) : checking ? (
                        <span className="flex items-center gap-1.5 text-muted">
                          <Loader2 size={13} className="animate-spin" /> Checking availability…
                        </span>
                      ) : nameCheck.data?.available ? (
                        <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 text-mint">
                          <Check size={13} /> {name} is available
                        </motion.span>
                      ) : (
                        <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 text-rose">
                          <CircleAlert size={13} /> {nameCheck.data?.reason ?? "Not available"}
                        </motion.span>
                      )
                    }
                  >
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(slugify(e.target.value))}
                      onKeyDown={(e) => e.key === "Enter" && canNext && go(2)}
                      placeholder="payments-api"
                      spellCheck={false}
                      className={clsx(inputClass, "font-mono")}
                    />
                  </Field>
                  <Field label="Owner" hint={<span className="text-faint">The team on call for this service.</span>}>
                    <input value={owner} onChange={(e) => setOwner(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Description">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={280}
                      rows={3}
                      placeholder="What does this service do?"
                      className={clsx(inputClass, "h-auto resize-none py-3")}
                    />
                  </Field>
                </div>

                <div className="panel p-7">
                  <div className="flex items-center gap-3">
                    <TemplateIcon id={template.id} accent={template.accent} size={40} />
                    <div>
                      <p className="text-xs text-faint">You'll get</p>
                      <p className="font-display font-semibold">{template.name}</p>
                    </div>
                  </div>
                  <dl className="mt-6 space-y-4">
                    {preview.map((row) => (
                      <div key={row.label} className="rounded-xl border border-white/[0.06] bg-ink-900/60 px-4 py-3">
                        <dt className="text-[11px] uppercase tracking-widest text-faint">{row.label}</dt>
                        <dd className="mt-1 font-mono text-[13px] text-fg">
                          <Morph value={row.value} className="max-w-full" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}

            {step === 2 && template && (
              <div className="mx-auto max-w-2xl">
                <GlowCard glow={template.accent} className="overflow-hidden p-0">
                  <div
                    className="h-28"
                    style={{
                      background: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${template.accent} 45%, transparent), transparent 60%), radial-gradient(120% 140% at 100% 0%, rgb(34 211 238 / 0.25), transparent 60%)`,
                    }}
                  />
                  <div className="-mt-10 px-8 pb-8">
                    <TemplateIcon id={template.id} accent={template.accent} size={64} />
                    <h2 className="mt-5 font-mono text-2xl text-fg">{name}</h2>
                    <p className="mt-1 text-sm text-muted">{description || "No description"}</p>
                    <div className="mt-8 grid gap-3 sm:grid-cols-2">
                      {[
                        ["Template", template.name],
                        ["Runtime", template.runtime],
                        ["Owner", owner],
                        ["Port", String(template.port)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-white/[0.06] bg-ink-900/60 px-4 py-3">
                          <p className="text-[11px] uppercase tracking-widest text-faint">{label}</p>
                          <p className="mt-1 text-sm text-fg">{value}</p>
                        </div>
                      ))}
                    </div>
                    {create.isError && (
                      <p className="mt-6 flex items-center gap-2 rounded-xl border border-rose/20 bg-rose/10 px-4 py-3 text-sm text-rose">
                        <CircleAlert size={15} /> {create.error.message}
                      </p>
                    )}
                  </div>
                </GlowCard>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <MagneticButton variant="ghost" onClick={() => go(step - 1)} disabled={step === 0} className={step === 0 ? "invisible" : ""}>
          <ArrowLeft size={16} /> Back
        </MagneticButton>
        {step < 2 ? (
          <MagneticButton onClick={() => go(step + 1)} disabled={!canNext}>
            Continue <ArrowRight size={16} />
          </MagneticButton>
        ) : (
          <MagneticButton size="lg" onClick={launch} disabled={create.isPending || counting}>
            <Rocket size={18} /> Launch {name}
          </MagneticButton>
        )}
      </div>

      <AnimatePresence>{counting && <Countdown onDone={finishCountdown} />}</AnimatePresence>
    </div>
  );
}
