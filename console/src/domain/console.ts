export type ViewId =
  | "overview"
  | "tenants"
  | "connectors"
  | "routing"
  | "events"
  | "usage"
  | "audit";

export type Health = "healthy" | "degraded" | "failed";
export type Tone = "positive" | "warning" | "critical" | "neutral";

export interface Metric {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface AttentionItem {
  id: string;
  tenantId: string;
  title: string;
  detail: string;
  time: string;
  tone: Exclude<Tone, "neutral">;
}

export interface ProviderHealth {
  name: string;
  status: Health;
  uptime: string;
  latency: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: Health;
  connections: number;
  calls: string;
  spend: string;
}

export interface Connection {
  id: string;
  tenantId: string;
  provider: string;
  account: string;
  tenant: string;
  status: Health;
  lastSync: string;
  eventCount: string;
}

export interface ModelRoute {
  id: string;
  tenantId: string;
  tenant: string;
  useCase: string;
  primary: string;
  fallback: string;
  status: Health;
}

export interface EventRecord {
  id: string;
  tenantId: string;
  topic: string;
  tenant: string;
  status: Health;
  attempts: number;
  receivedAt: string;
}

export interface UsageMeter {
  label: string;
  value: string;
  detail: string;
  progress: number;
  tone: Tone;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string;
  source: string;
  time: string;
}

export interface ConsoleSnapshot {
  metrics: Metric[];
  attention: AttentionItem[];
  providers: ProviderHealth[];
  tenants: Tenant[];
  connections: Connection[];
  routes: ModelRoute[];
  events: EventRecord[];
  usage: UsageMeter[];
  audit: AuditEntry[];
}

export interface ConsoleRepository {
  getSnapshot(): Promise<ConsoleSnapshot>;
}
