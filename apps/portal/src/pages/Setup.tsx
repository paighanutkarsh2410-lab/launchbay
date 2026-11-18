import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Boxes,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Cloud,
  GitBranch,
  Github,
  KeyRound,
  Loader2,
  PartyPopper,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { MagneticButton } from "@/components/MagneticButton";
import { api, type SetupCheck } from "@/lib/api";

const ease = [0.16, 1, 0.3, 1] as const;

/** Sends the browser to GitHub with a pre-filled "Create GitHub App" form. */
function postToGitHub(action: string, manifest: object) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

function StateIcon({ check }: { check: SetupCheck }) {
  if (check.ok === true) return <CircleCheck size={20} className="text-mint" />;
  if (check.ok === false) return <CircleX size={20} className="text-rose" />;
  return <CircleDashed size={20} className="text-faint" />;
}

function Step({
  icon: Icon,
  title,
  check,
  optional,
  index,
  children,
}: {
  icon: LucideIcon;
  title: string;
  check: SetupCheck;
  optional?: boolean;
  index: number;
  children?: React.ReactNode;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.5, ease }}
      className={clsx("panel p-5", check.ok === true && "border-mint/20")}
    >
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-muted">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display font-semibold">{title}</p>
            {optional && <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-faint">optional</span>}
          </div>
          <p className="mt-1 break-words text-sm text-muted">{check.detail}</p>
          {children}
        </div>
        <StateIcon check={check} />
      </div>
    </motion.li>
  );
}

/** First run: what is ready, and one click to connect GitHub. */
export function Setup() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { data: status, isError } = useQuery({ queryKey: ["setup"], queryFn: api.setup, retry: false });
  const [owner, setOwner] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const org = owner ?? status?.owner ?? "";

  async function connect() {
    setStarting(true);
    setError(null);
    try {
      const { action, manifest } = await api.githubManifest(org.trim());
      postToGitHub(action, manifest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }

  if (isError) {
    return (
      <div className="panel mx-auto mt-10 max-w-xl p-8 text-center">
        <p className="font-display text-xl font-semibold">Setup isn't available here</p>
        <p className="mt-2 text-sm text-muted">
          It only runs on the machine hosting Launchbay, and never in the public demo.
        </p>
      </div>
    );
  }

  const connected = params.get("connected");
  const failure = params.get("error");
  const live = status?.mode === "github";

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.2em] text-violet-soft">Self-hosted</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Set up Launchbay</h1>
      <p className="mt-3 max-w-xl text-muted">
        Everything runs on this machine with your own accounts. Keys stay in <code className="font-mono text-fg">~/.launchbay</code>,
        never in the repository.
      </p>

      {connected && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-6 flex items-center gap-3 rounded-2xl border border-mint/25 bg-mint/10 px-5 py-4 text-sm"
        >
          <PartyPopper size={20} className="text-mint" />
          <span>
            <span className="font-medium text-fg">Connected to {connected}.</span>{" "}
            <span className="text-muted">
              {params.get("gitops") === "created" ? "Launchbay created its GitOps repo there. " : ""}
              Launches are real from now on.
            </span>
          </span>
        </motion.div>
      )}
      {(failure || error) && (
        <p className="mt-6 flex items-center gap-2 rounded-2xl border border-rose/20 bg-rose/10 px-5 py-4 text-sm text-rose">
          <CircleAlert size={16} /> {failure ?? error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-2 text-sm">
        <span className="text-muted">Launches are</span>
        <span
          className={clsx(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            live ? "bg-mint/15 text-mint" : "bg-amber/15 text-amber",
          )}
        >
          {status ? (live ? "real" : "simulated (demo mode)") : "…"}
        </span>
      </div>

      {!status && <div className="mt-6 h-64 animate-pulse rounded-2xl bg-white/[0.03]" />}
      {status && (
        <ol className="mt-6 space-y-3">
          <Step index={0} icon={Boxes} title="Platform" check={status.platform} />
          <Step index={1} icon={Github} title="GitHub" check={status.github}>
            {status.github.ok !== true && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-faint">
                  Launchbay creates a GitHub App for an organization (a free one works) and installs it there. You
                  approve both on GitHub; nothing is copied by hand.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={org}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="your-org"
                    aria-label="GitHub organization"
                    spellCheck={false}
                    className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900/70 px-4 font-mono text-sm text-fg outline-none placeholder:text-faint focus:border-violet/70"
                  />
                  <MagneticButton onClick={() => void connect()} disabled={!org.trim() || starting}>
                    {starting ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />}
                    Connect GitHub
                  </MagneticButton>
                </div>
                {status.app_slug && status.github.ok === false && (
                  <a
                    className="inline-block text-xs text-violet-soft hover:underline"
                    href={`https://github.com/apps/${status.app_slug}/installations/new`}
                  >
                    The App exists; install it on {status.owner} →
                  </a>
                )}
              </div>
            )}
          </Step>
          <Step index={2} icon={GitBranch} title="GitOps repository" check={status.gitops} />
          <Step index={3} icon={KeyRound} title="Private images" check={status.registry} optional />
          <Step index={4} icon={Cloud} title="Cloud resources" check={status.cloud} optional />
          <Step index={5} icon={Sparkles} title="AI failure explanations" check={status.assistant} optional />
        </ol>
      )}
      {status && (
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["setup"] })}
          className="mt-4 text-xs text-faint hover:text-muted"
        >
          Check again
        </button>
      )}
    </div>
  );
}
