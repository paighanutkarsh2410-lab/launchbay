import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUpRight, Rocket, Search } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { GlowCard } from "@/components/GlowCard";
import { MagneticButton } from "@/components/MagneticButton";
import { StatusBadge } from "@/components/StatusDot";
import { TemplateIcon } from "@/components/TemplateIcon";
import { api, type ServiceStatus } from "@/lib/api";
import { timeAgo } from "@/lib/format";

const filters: { key: ServiceStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "launching", label: "Launching" },
  { key: "failed", label: "Failed" },
];

export function Catalog() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ServiceStatus | "all">("all");
  const [query, setQuery] = useState("");
  const { data: services = [], isLoading } = useQuery({ queryKey: ["services"], queryFn: api.services, refetchInterval: 4000 });
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const templateById = Object.fromEntries(templates.map((t) => [t.id, t]));

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: services.length };
    for (const s of services) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [services]);

  const visible = services.filter(
    (s) =>
      (filter === "all" || s.status === filter) &&
      `${s.name} ${s.owner} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Catalog</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Services</h1>
          <p className="mt-2 text-muted">Everything launched through Launchbay, with who owns it and where it runs.</p>
        </div>
        <MagneticButton onClick={() => navigate("/launch")}>
          <Rocket size={16} /> New service
        </MagneticButton>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <LayoutGroup id="filters">
          <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-1">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx("relative h-8 rounded-full px-3.5 text-sm transition-colors", filter === f.key ? "text-fg" : "text-muted hover:text-fg")}
              >
                {filter === f.key && (
                  <motion.span layoutId="filter-pill" className="absolute inset-0 rounded-full bg-white/10" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                )}
                <span className="relative">
                  {f.label}
                  <span className="ml-1.5 text-xs text-faint">{counts[f.key] ?? 0}</span>
                </span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, owner…"
            className="h-10 w-full rounded-full border border-white/10 bg-white/[0.03] pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-faint focus:border-violet/60"
          />
        </div>
      </div>

      <motion.div layout className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading && Array.from({ length: 6 }, (_, i) => <div key={i} className="panel h-44 animate-pulse" />)}
        <AnimatePresence mode="popLayout">
          {visible.map((service) => {
            const template = templateById[service.template_id];
            return (
              <motion.div
                key={service.id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
              >
                <Link to={`/services/${service.name}`} className="block h-full">
                  <GlowCard glow={template?.accent} className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <TemplateIcon id={service.template_id} accent={template?.accent ?? "#7c5cff"} size={42} />
                      <StatusBadge status={service.status} />
                    </div>
                    <p className="mt-5 truncate font-mono text-[15px] text-fg">{service.name}</p>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted">{service.description || template?.description}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs text-faint">
                      <span>{service.owner}</span>
                      <span className="flex items-center gap-1">
                        {timeAgo(service.created_at)}
                        <ArrowUpRight size={14} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" />
                      </span>
                    </div>
                  </GlowCard>
                </Link>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {!isLoading && visible.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel mt-6 flex flex-col items-center gap-2 py-16 text-center">
          <p className="font-display text-lg">{services.length ? "No services match" : "No services yet"}</p>
          <p className="text-sm text-muted">{services.length ? "Try another filter or search." : "Launch one and it will show up here."}</p>
        </motion.div>
      )}
    </div>
  );
}
