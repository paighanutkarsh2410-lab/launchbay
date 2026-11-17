export type StepStatus = "pending" | "running" | "succeeded" | "failed";
export type ServiceStatus = "launching" | "live" | "failed" | "decommissioned";

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
}

export interface ServiceDetail extends Service {
  launch: Launch | null;
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
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

export const api = {
  templates: () => request<Template[]>("/templates"),
  services: () => request<Service[]>("/services"),
  service: (name: string) => request<ServiceDetail>(`/services/${name}`),
  stats: () => request<Stats>("/stats"),
  guardrails: () => request<Guardrail[]>("/guardrails"),
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
