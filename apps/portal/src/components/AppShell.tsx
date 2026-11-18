import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Boxes, Command, LayoutDashboard, Rocket, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { api } from "@/lib/api";
import { Backdrop } from "./Backdrop";
import { CommandPalette } from "./CommandPalette";
import { DemoBanner, useInfo, WakingNotice } from "./DemoBanner";
import { Logo } from "./Logo";
import { StatusDot } from "./StatusDot";

const nav = [
  { to: "/", label: "Mission control", icon: LayoutDashboard, end: true },
  { to: "/launch", label: "Launch", icon: Rocket, end: false },
  { to: "/services", label: "Catalog", icon: Boxes, end: false },
];

function NavItem({ to, label, icon: Icon, end }: (typeof nav)[number]) {
  return (
    <NavLink to={to} end={end} className="relative block">
      {({ isActive }) => (
        <span
          className={clsx(
            "relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200",
            isActive ? "text-fg" : "text-muted hover:text-fg",
          )}
        >
          {isActive && (
            <motion.span
              layoutId="nav-pill"
              className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          <Icon size={17} className="relative" />
          <span className="relative">{label}</span>
        </span>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 5000 });
  const { data: info } = useInfo();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <Backdrop />

      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/40 px-4 py-6 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-10 space-y-1">
          {nav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="panel p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Cluster</span>
              <span className="flex items-center gap-1.5 text-mint">
                <StatusDot status="live" /> {info?.public_demo ? "Simulated" : "Healthy"}
              </span>
            </div>
            <p className="mt-2 font-mono text-[13px] text-fg">{info?.public_demo ? "demo-cluster" : "kind-launchbay"}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
                <p className="text-faint">Services</p>
                <p className="mt-0.5 font-display text-base text-fg">{stats?.services ?? "–"}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
                <p className="text-faint">Live</p>
                <p className="mt-0.5 font-display text-base text-mint">{stats?.live ?? "–"}</p>
              </div>
            </div>
          </div>
          <p className="px-2 text-[11px] text-faint">Launchbay v1.0</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/[0.06] bg-ink-950/50 px-5 backdrop-blur-xl sm:px-8">
          <div className="shrink-0 lg:hidden">
            <Logo compact />
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="ml-auto flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-3 text-sm text-faint transition-colors hover:border-white/20 hover:text-muted sm:w-full sm:max-w-sm sm:px-3.5 lg:ml-0"
          >
            <Search size={15} />
            <span className="hidden sm:inline">Search services, jump anywhere…</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <span className="kbd"><Command size={10} /></span>
              <span className="kbd">K</span>
            </span>
          </button>
          <nav className="flex shrink-0 items-center gap-1 lg:hidden">
            {nav.map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) =>
                  clsx("flex size-9 items-center justify-center rounded-full", isActive ? "bg-white/10 text-fg" : "text-muted")
                }
              >
                <Icon size={17} />
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-muted">
              <StatusDot status={stats?.launching ? "running" : "live"} />
              {stats?.launching ? `${stats.launching} launching` : "All systems nominal"}
            </span>
          </div>
        </header>

        <main className="relative flex-1 px-5 pb-20 pt-8 sm:px-8 lg:px-12">
          <DemoBanner />
          <WakingNotice />
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto max-w-6xl"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
