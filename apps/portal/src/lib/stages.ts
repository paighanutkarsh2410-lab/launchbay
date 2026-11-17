import { GitBranch, GitCommitHorizontal, Radio, ShieldCheck, Ship, Workflow, type LucideIcon } from "lucide-react";

export interface StageInfo {
  key: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
}

export const STAGES: StageInfo[] = [
  { key: "validate", title: "Validate", blurb: "Name, template and owner checked", icon: ShieldCheck },
  { key: "repository", title: "Repository", blurb: "Repo created from the template", icon: GitBranch },
  { key: "pipeline", title: "Build & sign", blurb: "Tested, scanned, signed with cosign", icon: Workflow },
  { key: "gitops", title: "GitOps", blurb: "Manifest committed to the GitOps repo", icon: GitCommitHorizontal },
  { key: "deploy", title: "Deploy", blurb: "Argo CD syncs it to its namespace", icon: Ship },
  { key: "live", title: "Live", blurb: "Health check passes, URL is ready", icon: Radio },
];

export const stageByKey = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<string, StageInfo>;
