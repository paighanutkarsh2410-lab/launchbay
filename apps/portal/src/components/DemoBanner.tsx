import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CirclePlay, Code2, FlaskConical, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "@/lib/api";

const ease = [0.16, 1, 0.3, 1] as const;

/** What this Launchbay is: the public demo, or a real one. Retries until the API answers. */
export function useInfo() {
  return useQuery({
    queryKey: ["info"],
    queryFn: api.info,
    staleTime: Infinity,
    retry: true,
    retryDelay: 2500,
  });
}

/** Above every page of the public demo: launches here are simulated. */
export function DemoBanner() {
  const { data: info } = useInfo();
  const { pathname } = useLocation();
  if (info && !info.public_demo && info.mode === "demo" && pathname !== "/setup") {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-amber/25 bg-amber/[0.07] px-4 py-3 text-sm"
      >
        <span className="flex items-center gap-2 font-medium text-amber">
          <FlaskConical size={16} /> Demo mode
        </span>
        <span className="min-w-0 flex-1 text-muted">Launches are simulated until GitHub is connected.</span>
        <Link to="/setup" className="flex items-center gap-1.5 rounded-lg bg-amber/15 px-3 py-1.5 text-xs font-medium text-fg hover:bg-amber/25">
          Finish setup <ArrowRight size={14} />
        </Link>
      </motion.div>
    );
  }
  if (!info?.public_demo) return null;
  const video = "/media/launchbay-demo.mp4";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-violet/25 bg-violet/[0.08] px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2 font-medium text-violet-soft">
        <FlaskConical size={16} /> Public demo
      </span>
      <span className="min-w-0 flex-1 text-muted">
        Launches here are simulated stage by stage and cleared after {info.demo_ttl_hours ?? 3} hours. The real
        thing creates GitHub repos, runs Terraform and deploys with Argo CD.
      </span>
      <span className="flex items-center gap-2">
        <a
          href={video}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-violet/20 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-violet/30"
        >
          <CirclePlay size={14} /> Watch a real launch
        </a>
        <a
          href={info.project_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          <Code2 size={14} /> Source
        </a>
      </span>
    </motion.div>
  );
}

/** Free hosting puts the demo API to sleep when idle; say so instead of showing empty panels. */
export function WakingNotice() {
  const { data, failureCount } = useInfo();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (data) return;
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, [data]);
  const show = !data && (slow || failureCount > 0);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.4, ease }}
          className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/90 px-4 py-3 text-sm shadow-2xl backdrop-blur-xl"
        >
          <Loader2 size={18} className="shrink-0 animate-spin text-violet-soft" />
          <span className="text-muted">
            <span className="text-fg">Waking up the demo server.</span> Free hosting naps when nobody is around;
            this usually takes under a minute.
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
