import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, Check, CircleAlert, Loader2, PowerOff, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { MagneticButton } from "./MagneticButton";

type Mode = "archive" | "delete";

const modes: { key: Mode; title: string; blurb: string; icon: typeof Archive }[] = [
  {
    key: "archive",
    title: "Archive the repository",
    blurb: "Code and history stay on GitHub, read-only. The name stays reserved.",
    icon: Archive,
  },
  {
    key: "delete",
    title: "Delete the repository",
    blurb: "Removes the repo for good and frees the name. Cannot be undone.",
    icon: Trash2,
  },
];

/** Confirms and runs a decommission: GitOps manifest out, Argo CD prunes, repo archived or deleted. */
export function DecommissionDialog({ name, open, onClose }: { name: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("archive");
  const [typed, setTyped] = useState("");
  const run = useMutation({
    mutationFn: () => api.decommission(name, mode),
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !run.isPending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, run.isPending]);

  const confirmed = typed === name;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm" onClick={() => !run.isPending && onClose()} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="decommission-title"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="panel relative w-full max-w-lg overflow-hidden p-7 shadow-2xl shadow-black/60"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-32"
              style={{ background: "radial-gradient(120% 100% at 50% 0%, rgb(251 113 133 / 0.16), transparent 70%)" }}
            />

            <AnimatePresence mode="wait" initial={false}>
              {run.isSuccess ? (
                <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] text-muted">
                    <PowerOff size={22} />
                  </span>
                  <h2 className="mt-5 font-display text-xl font-semibold">{name} is decommissioned</h2>
                  <ul className="mt-5 space-y-2.5">
                    {run.data.steps.map((step, i) => (
                      <motion.li
                        key={step}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + i * 0.18 }}
                        className="flex items-start gap-3 text-sm text-muted"
                      >
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.25 + i * 0.18, type: "spring", stiffness: 500, damping: 20 }}
                          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mint/15 text-mint"
                        >
                          <Check size={12} strokeWidth={3} />
                        </motion.span>
                        {step}
                      </motion.li>
                    ))}
                  </ul>
                  <div className="mt-8 flex justify-end">
                    <MagneticButton onClick={() => navigate("/services")}>Back to the catalog</MagneticButton>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="form" exit={{ opacity: 0, y: -8 }} className="relative">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-rose/15 text-rose">
                    <PowerOff size={22} />
                  </span>
                  <h2 id="decommission-title" className="mt-5 font-display text-xl font-semibold">
                    Decommission <span className="font-mono">{name}</span>?
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Its manifest is removed from GitOps and Argo CD prunes the deployment, service and ingress.
                  </p>

                  <div className="mt-6 space-y-2.5" role="radiogroup" aria-label="What happens to the repository">
                    {modes.map((m) => {
                      const selected = mode === m.key;
                      const danger = m.key === "delete";
                      return (
                        <button
                          key={m.key}
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setMode(m.key)}
                          className={clsx(
                            "relative flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition-colors duration-200",
                            selected
                              ? danger
                                ? "border-rose/40 bg-rose/[0.07]"
                                : "border-violet/50 bg-violet/[0.08]"
                              : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]",
                          )}
                        >
                          <m.icon size={18} className={clsx("mt-0.5 shrink-0", selected ? (danger ? "text-rose" : "text-violet-soft") : "text-faint")} />
                          <span>
                            <span className="block text-sm font-medium text-fg">{m.title}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-muted">{m.blurb}</span>
                          </span>
                          <span
                            className={clsx(
                              "ml-auto mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border",
                              selected ? (danger ? "border-rose" : "border-violet-soft") : "border-white/20",
                            )}
                          >
                            {selected && (
                              <motion.span
                                layoutId="decommission-radio"
                                className={clsx("size-2 rounded-full", danger ? "bg-rose" : "bg-violet-soft")}
                              />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <label className="mt-6 block">
                    <span className="text-xs text-muted">
                      Type <span className="font-mono text-fg">{name}</span> to confirm
                    </span>
                    <input
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && confirmed && !run.isPending && run.mutate()}
                      spellCheck={false}
                      className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-ink-900/70 px-4 font-mono text-sm text-fg outline-none transition-[border-color,box-shadow] focus:border-rose/60 focus:shadow-[0_0_0_4px_rgb(251_113_133/0.12)]"
                    />
                  </label>

                  {run.isError && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 flex items-center gap-2 rounded-xl border border-rose/20 bg-rose/10 px-3.5 py-2.5 text-sm text-rose"
                    >
                      <CircleAlert size={15} /> {run.error.message}
                    </motion.p>
                  )}

                  <div className="mt-7 flex items-center justify-end gap-2">
                    <MagneticButton variant="ghost" onClick={onClose} disabled={run.isPending}>
                      Cancel
                    </MagneticButton>
                    <button
                      onClick={() => run.mutate()}
                      disabled={!confirmed || run.isPending}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-rose px-5 text-sm font-medium text-ink-950 shadow-[0_8px_30px_-8px_rgb(251_113_133/0.7)] transition-[opacity,transform] hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
                    >
                      {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <PowerOff size={15} />}
                      {run.isPending ? "Decommissioning…" : "Decommission"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
