export type ViewId =
  | "overview"
  | "tenants"
  | "connectors"
  | "routing"
  | "llm"
  | "events"
  | "usage"
  | "audit";

export type Health = "healthy" | "degraded" | "failed";
export type Tone = "positive" | "warning" | "critical" | "neutral";
export type DataMode = "prototype" | "live";

export interface ConsoleActor {
  kind: "user" | "service";
  role: "viewer" | "operator" | "admin";
}

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
  id: string;
  name: string;
  status: Health;
  detail: string;
  window: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: Health;
  connections: number;
  actions: string;
  cost: string;
}

export interface Connection {
  id: string;
  tenantId: string;
  provider: string;
  account: string;
  tenant: string;
  status: Health;
  lastActivity: string;
  actionCount: string;
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
  tenantId: string;
  label: string;
  value: string;
  detail: string;
  progress?: number;
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

export interface LlmModel {
  id: string;
  provider: string;
  endpoint: string;
  status: Health;
  inCostMicrosPerMtok: number;
  outCostMicrosPerMtok: number;
  credentialVersion: number;
}

export interface LlmRoute {
  id: string;
  tenantId: string | null;
  taskClass: string;
  targets: string[];
  version: number;
  status: Health;
}

export interface ConsoleSnapshot {
  mode: DataMode;
  generatedAt: string;
  auditId: number;
  actor: ConsoleActor;
  metrics: Metric[];
  attention: AttentionItem[];
  providers: ProviderHealth[];
  tenants: Tenant[];
  connections: Connection[];
  routes: ModelRoute[];
  events: EventRecord[];
  usage: UsageMeter[];
  audit: AuditEntry[];
  llmModels: LlmModel[];
  llmRoutes: LlmRoute[];
}

export interface ConsoleRepository {
  getSnapshot(): Promise<ConsoleSnapshot>;
}
