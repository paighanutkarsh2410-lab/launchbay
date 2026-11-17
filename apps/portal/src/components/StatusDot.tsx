import clsx from "clsx";
import type { ServiceStatus, StepStatus } from "@/lib/api";

const colors: Record<ServiceStatus | StepStatus, string> = {
  live: "bg-mint",
  succeeded: "bg-mint",
  launching: "bg-violet-soft",
  running: "bg-violet-soft",
  failed: "bg-rose",
  pending: "bg-faint",
};

const labels: Record<ServiceStatus, string> = { live: "Live", launching: "Launching", failed: "Failed" };

export function StatusDot({ status, className }: { status: ServiceStatus | StepStatus; className?: string }) {
  const active = status === "launching" || status === "running" || status === "live";
  return (
    <span className={clsx("relative inline-flex size-2", className)}>
      {active && <span className={clsx("absolute inset-0 rounded-full animate-ping-soft", colors[status])} />}
      <span className={clsx("relative inline-flex size-2 rounded-full", colors[status])} />
    </span>
  );
}

export function StatusBadge({ status }: { status: ServiceStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
        status === "live" && "border-mint/20 bg-mint/10 text-mint",
        status === "launching" && "border-violet/25 bg-violet/10 text-violet-soft",
        status === "failed" && "border-rose/20 bg-rose/10 text-rose",
      )}
    >
      <StatusDot status={status} />
      {labels[status]}
    </span>
  );
}
