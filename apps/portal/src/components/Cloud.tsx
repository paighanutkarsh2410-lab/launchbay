import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, Check, Copy, Database, KeyRound, MessagesSquare, Terminal, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, type ResourceKind, type ServiceDetail } from "@/lib/api";

export const resourceLook: Record<ResourceKind | "key", { icon: LucideIcon; color: string; title: string }> = {
  key: { icon: KeyRound, color: "#a594ff", title: "Encryption key" },
  bucket: { icon: Archive, color: "#ff7a45", title: "Object storage" },
  queue: { icon: MessagesSquare, color: "#fbbf24", title: "Message queue" },
  table: { icon: Database, color: "#22d3ee", title: "Key-value table" },
};

const ease = [0.16, 1, 0.3, 1] as const;

function useCloudInfo() {
  return useQuery({ queryKey: ["cloud"], queryFn: api.cloud, staleTime: Infinity });
}

function TargetBadge({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-muted">
      <span className="relative flex size-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-mint/70" />
        <span className="relative size-1.5 rounded-full bg-mint" />
      </span>
      Terraform → {label}
    </span>
  );
}

/** Wizard: pick the cloud resources a new service gets. */
export function ResourcePicker({ value, onChange }: { value: ResourceKind[]; onChange: (next: ResourceKind[]) => void }) {
  const { data: info } = useCloudInfo();
  const toggle = (id: ResourceKind) =>
    onChange(value.includes(id) ? value.filter((k) => k !== id) : [...value, id]);

  return (
    <div className="panel p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">
            Cloud resources <span className="font-normal text-faint">· optional</span>
          </p>
          <p className="mt-1 text-xs text-faint">
            Provisioned with Terraform, encrypted with a key of the service's own, and handed to it as environment variables.
          </p>
        </div>
        <TargetBadge label={info?.label} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {(info?.kinds ?? []).map((kind, i) => {
          const { icon: Icon, color } = resourceLook[kind.id];
          const on = value.includes(kind.id);
          return (
            <motion.button
              key={kind.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={`${kind.title} (${kind.service})`}
              onClick={() => toggle(kind.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.5, ease }}
              whileTap={{ scale: 0.98 }}
              className={clsx(
                "relative overflow-hidden rounded-2xl border p-4 text-left transition-colors duration-300",
                on ? "border-transparent bg-white/[0.04]" : "border-white/[0.07] bg-ink-900/50 hover:border-white/15",
              )}
            >
              {/* Selected: a ring and a wash in the resource's color. */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl"
                initial={false}
                animate={{ opacity: on ? 1 : 0 }}
                transition={{ duration: 0.3 }}
                style={{
                  boxShadow: `inset 0 0 0 1.5px ${color}`,
                  background: `radial-gradient(120% 90% at 0% 0%, color-mix(in oklab, ${color} 16%, transparent), transparent 65%)`,
                }}
              />
              <div className="relative flex items-start justify-between">
                <motion.span
                  className="flex size-10 items-center justify-center rounded-xl"
                  style={{ background: `color-mix(in oklab, ${color} ${on ? 22 : 10}%, transparent)`, color }}
                  animate={on ? { scale: [1, 1.18, 1], rotate: [0, -8, 0] } : { scale: 1, rotate: 0 }}
                  transition={{ duration: 0.45, ease }}
                >
                  <Icon size={19} />
                </motion.span>
                <span
                  className={clsx(
                    "flex size-5 items-center justify-center rounded-md border transition-colors duration-200",
                    on ? "border-transparent text-ink-950" : "border-white/15",
                  )}
                  style={on ? { background: color } : undefined}
                >
                  <AnimatePresence>
                    {on && (
                      <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}>
                        <Check size={13} strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </div>
              <p className="relative mt-4 font-display font-semibold text-fg">{kind.title}</p>
              <p className="relative font-mono text-[11px] text-faint">{kind.service}</p>
              <p className="relative mt-2 text-[13px] leading-snug text-muted">{kind.description}</p>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="relative overflow-hidden"
                  >
                    <code className="mt-3 inline-block rounded-md bg-ink-950/70 px-2 py-1 font-mono text-[11px]" style={{ color }}>
                      ${kind.env}
                    </code>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
        {!info && Array.from({ length: 3 }, (_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-white/[0.03]" />)}
      </div>
    </div>
  );
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-white/10 hover:text-fg"
      aria-label={label}
    >
      {copied ? <Check size={14} className="text-mint" /> : <Copy size={14} />}
    </button>
  );
}

/** Service page: what Terraform provisioned and the variables the service runs with. */
export function CloudPanel({ service, provisioning }: { service: ServiceDetail; provisioning: boolean }) {
  const { data: info } = useCloudInfo();
  if (!service.resources.length) return null;
  const cloud = service.cloud;
  const pending = !cloud;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className="panel p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Cloud resources</p>
          <h2 className="mt-1 font-display text-lg font-semibold">
            {pending ? (provisioning ? "Provisioning with Terraform…" : "Not provisioned yet") : `${cloud.resources.length} resources`}
          </h2>
        </div>
        <TargetBadge label={info?.label} />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ul className="space-y-2">
          {pending &&
            service.resources.map((kind) => {
              const { icon: Icon, color, title } = resourceLook[kind];
              return (
                <li key={kind} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/50 px-3 py-2.5">
                  <span className="flex size-9 items-center justify-center rounded-lg" style={{ background: `color-mix(in oklab, ${color} 12%, transparent)`, color }}>
                    <Icon size={17} />
                  </span>
                  <span className={clsx("text-sm", provisioning ? "shimmer-text" : "text-muted")}>{title}</span>
                </li>
              );
            })}
          {cloud?.resources.map((resource, i) => {
            const { icon: Icon, color, title } = resourceLook[resource.kind];
            return (
              <motion.li
                key={resource.arn}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.45, ease }}
                className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-900/50 px-3 py-2.5"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-sm">
                    <span className="text-fg">{title}</span>
                    <span className="truncate font-mono text-xs text-muted">{resource.name}</span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-faint" title={resource.arn}>
                    {resource.arn}
                  </p>
                </div>
                <CopyText text={resource.arn} label={`Copy the ARN of ${resource.name}`} />
              </motion.li>
            );
          })}
        </ul>

        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-ink-950/70">
          <p className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[11px] uppercase tracking-widest text-faint">
            <Terminal size={13} /> Environment
          </p>
          <div className="space-y-1 overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
            {pending && <p className="text-faint">Set once the resources exist.</p>}
            {cloud &&
              Object.entries(cloud.env).map(([key, value], i) => (
                <motion.p
                  key={key}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 + i * 0.07 }}
                  className="whitespace-nowrap"
                >
                  <span className="text-violet-soft">{key}</span>
                  <span className="text-faint">=</span>
                  <span className="text-fg">{value}</span>
                </motion.p>
              ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
