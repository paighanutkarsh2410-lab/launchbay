export type StepStatus = "pending" | "running" | "succeeded" | "failed";
export type ServiceStatus = "launching" | "live" | "failed" | "decommissioned";
export type ResourceKind = "bucket" | "queue" | "table";

export interface Template {
  id: string;
  name: string;
  description: string;
  language: string;
  runtime: string;
  port: number;
  tags: string[];
  accent: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  template_id: string;
  owner: string;
  status: ServiceStatus;
  repo_url: string | null;
  url: string | null;
  resources: ResourceKind[];
  created_at: string;
}

export interface Step {
  key: string;
  title: string;
  position: number;
  status: StepStatus;
  detail: string | null;
  logs: string[];
  started_at: string | null;
  finished_at: string | null;
}

export interface Launch {
  id: string;
  status: StepStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  steps: Step[];
  explanation: Explanation | null;
}

export interface CloudResource {
  kind: ResourceKind | "key";
  name: string;
  arn: string;
}

export interface ServiceDetail extends Service {
  launch: Launch | null;
  cloud: { env: Record<string, string>; resources: CloudResource[] } | null;
}

export interface CloudInfo {
  mode: "simulated" | "emulator";
  label: string;
  kinds: { id: ResourceKind; title: string; service: string; description: string; env: string }[];
}

export interface Stats {
  services: number;
  live: number;
  launching: number;
  failed: number;
  median_launch_seconds: number | null;
}

export interface NameCheck {
  name: string;
  available: boolean;
  reason: string | null;
}

export interface NewService {
  name: string;
  template_id: string;
  owner: string;
  description: string;
  resources: ResourceKind[];
}

export interface Guardrail {
  name: string;
  title: string;
  summary: string;
  kind: string;
  rules: string[];
}

export interface DecommissionResult {
  name: string;
  repository: "archive" | "delete";
  steps: string[];
}

export type Grade = "Gold" | "Silver" | "Bronze" | "Needs work";

export interface ScoreCheck {
  id: string;
  title: string;
  category: "Ownership" | "Delivery" | "Security" | "Reliability";
  weight: number;
  description: string;
  remedy: string;
  result: "pass" | "fail" | "skip";
  detail: string;
}

export interface Scorecard {
  service: string;
  score: number;
  grade: Grade;
  checked_at: string;
  checks: ScoreCheck[];
}

export interface ScoreSummary {
  service: string;
  score: number;
  grade: Grade;
}

export interface Explanation {
  summary: string;
  cause: string;
  fix: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
  source: "claude" | "gemini" | "rules";
  model: string | null;
  stage: string;
  note: string | null;
}

export interface AssistantInfo {
  source: "claude" | "gemini" | "rules";
  label: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Where the API lives: same origin in development, its own host for the public demo. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join(", ")
      : (detail ?? response.statusText);
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export interface Info {
  public_demo: boolean;
  demo_ttl_hours: number | null;
  project_url: string;
  seeded: string[];
}

export const api = {
  info: () => request<Info>("/info"),
  templates: () => request<Template[]>("/templates"),
  services: () => request<Service[]>("/services"),
  service: (name: string) => request<ServiceDetail>(`/services/${name}`),
  stats: () => request<Stats>("/stats"),
  guardrails: () => request<Guardrail[]>("/guardrails"),
  cloud: () => request<CloudInfo>("/cloud"),
  assistant: () => request<AssistantInfo>("/assistant"),
  scorecards: () => request<ScoreSummary[]>("/scorecards"),
  scorecard: (name: string, fresh = false) =>
    request<Scorecard>(`/services/${name}/scorecard${fresh ? "?fresh=true" : ""}`),
  explain: (name: string, refresh = false) =>
    request<Explanation>(`/services/${name}/explain${refresh ? "?refresh=true" : ""}`, { method: "POST" }),
  checkName: (name: string) =>
    request<NameCheck>(`/services/check-name?name=${encodeURIComponent(name)}`),
  retry: (name: string) => request<Service>(`/services/${name}/retry`, { method: "POST" }),
  decommission: (name: string, repository: "archive" | "delete") =>
    request<DecommissionResult>(`/services/${name}/decommission`, {
      method: "POST",
      body: JSON.stringify({ repository }),
    }),
  createService: (body: NewService) =>
    request<Service>("/services", { method: "POST", body: JSON.stringify(body) }),
};
