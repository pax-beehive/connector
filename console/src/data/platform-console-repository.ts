import type {
  AuditEntry,
  Connection,
  ConsoleRepository,
  ConsoleSnapshot,
  Health,
  Tenant,
  Tone,
} from "../domain/console";

interface PlatformConsoleRepositoryOptions {
  edgeUrl: string;
  clientId: string;
  clientSecret: string;
  accessAssertion?: string;
  fetcher?: typeof fetch;
}

interface PlatformSnapshot {
  generated_at: string;
  audit_id: number;
  actor: { kind: "user" | "service"; role: "viewer" | "operator" | "admin" };
  tenants: PlatformTenant[];
  providers: PlatformProvider[];
  connections: PlatformConnection[];
  actions: PlatformAction[];
  usage: PlatformUsage[];
  audit: PlatformAuditEntry[];
}

interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface PlatformProvider {
  id: string;
  display_name: string;
  status: string;
}

interface PlatformConnection {
  id: string;
  tenant_id: string;
  provider_id: string;
  name: string;
  external_account_id?: string;
  status: string;
  last_health_at?: string;
  updated_at: string;
}

interface PlatformAction {
  id: string;
  tenant_id: string;
  connection_id?: string;
  provider_id: string;
  name: string;
  status: string;
  error_kind?: string;
  retryable: boolean;
  started_at: string;
  completed_at?: string;
}

interface PlatformUsage {
  tenant_id: string;
  meter: string;
  quantity: number;
  cost_micros: number;
  last_at: string;
}

interface PlatformAuditEntry {
  id: number;
  tenant_id?: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource?: string;
  outcome: string;
  created_at: string;
}

export class PlatformConsoleRepository implements ConsoleRepository {
  private readonly edgeUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly accessAssertion?: string;
  private readonly fetcher: typeof fetch;

  constructor(options: PlatformConsoleRepositoryOptions) {
    this.edgeUrl = validEdgeUrl(options.edgeUrl);
    this.clientId = requiredCredential(options.clientId, "client id");
    this.clientSecret = requiredCredential(options.clientSecret, "client secret");
    this.accessAssertion = optionalAssertion(options.accessAssertion);
    this.fetcher = options.fetcher ?? fetch;
  }

  async getSnapshot(): Promise<ConsoleSnapshot> {
    const response = await this.fetcher(`${this.edgeUrl}/v1/admin/snapshot`, {
      headers: {
        Accept: "application/json",
        "CF-Access-Client-Id": this.clientId,
        "CF-Access-Client-Secret": this.clientSecret,
        ...(this.accessAssertion ? { Authorization: `Bearer ${this.accessAssertion}` } : {}),
      },
      cache: "no-store",
      redirect: "manual",
    });
    if (!response.ok) {
      throw new Error(`Admin snapshot request failed with status ${response.status}`);
    }
    return mapPlatformSnapshot(parseSnapshot(await response.json()));
  }
}

function optionalAssertion(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!value || value.length > 16_384) throw new Error("Console Access assertion is invalid");
  return value;
}

function mapPlatformSnapshot(source: PlatformSnapshot): ConsoleSnapshot {
  const tenantByID = new Map(source.tenants.map((tenant) => [tenant.id, tenant]));
  const actionsByTenant = countBy(source.actions, (action) => action.tenant_id);
  const actionsByConnection = countBy(
    source.actions.filter(hasConnectionID),
    (action) => action.connection_id,
  );
  const connectionsByTenant = countBy(source.connections, (connection) => connection.tenant_id);
  const usageByTenant = sumUsageByTenant(source.usage);
  const totalCost = source.usage.reduce((sum, usage) => sum + usage.cost_micros, 0);
  const tenants = source.tenants.map((tenant) => mapTenant(
    tenant,
    connectionsByTenant.get(tenant.id) ?? 0,
    actionsByTenant.get(tenant.id) ?? 0,
    usageByTenant.get(tenant.id)?.costMicros ?? 0,
  ));
  const connections = source.connections.map((connection) => mapConnection(
    connection,
    tenantByID.get(connection.tenant_id)?.name ?? "Unknown tenant",
    actionsByConnection.get(connection.id) ?? 0,
  ));

  return {
    mode: "live",
    generatedAt: source.generated_at,
    auditId: source.audit_id,
    actor: { kind: source.actor.kind, role: source.actor.role },
    metrics: [
      metric("Tenants", source.tenants.length, `${activeCount(source.tenants)} active`, "positive"),
      metric("Connections", source.connections.length, `${activeCount(source.connections)} active`, healthTone(source.connections)),
      metric("Recent actions", source.actions.length, "Metadata ledger window", healthTone(source.actions)),
      { label: "Recorded cost", value: formatMoney(totalCost), detail: `${source.usage.length} usage aggregates`, tone: "neutral" },
    ],
    attention: source.actions.filter((action) => action.status !== "succeeded").map((action) => ({
      id: action.id,
      tenantId: action.tenant_id,
      title: `${action.name} · ${action.status}`,
      detail: action.error_kind ?? `${action.provider_id} action requires review`,
      time: formatTimestamp(action.completed_at ?? action.started_at),
      tone: action.retryable ? "warning" : "critical",
    })),
    providers: source.providers.map((provider) => ({
      id: provider.id,
      name: provider.display_name,
      status: healthFromStatus(provider.status),
      detail: provider.status,
      window: "Current metadata",
    })),
    tenants,
    connections,
    routes: [],
    events: [],
    usage: source.usage.map((usage) => ({
      tenantId: usage.tenant_id,
      label: `${tenantByID.get(usage.tenant_id)?.name ?? "Unknown tenant"} · ${usage.meter}`,
      value: formatQuantity(usage.quantity),
      detail: `${formatMoney(usage.cost_micros)} recorded · ${formatTimestamp(usage.last_at)}`,
      tone: "neutral",
    })),
    audit: source.audit.map((entry) => mapAudit(entry)),
  };
}

function mapTenant(source: PlatformTenant, connections: number, actions: number, costMicros: number): Tenant {
  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    status: healthFromStatus(source.status),
    connections,
    actions: formatQuantity(actions),
    cost: formatMoney(costMicros),
  };
}

function mapConnection(source: PlatformConnection, tenant: string, actionCount: number): Connection {
  return {
    id: source.id,
    tenantId: source.tenant_id,
    provider: source.provider_id,
    account: source.name,
    tenant,
    status: healthFromStatus(source.status),
    lastActivity: formatTimestamp(source.last_health_at ?? source.updated_at),
    actionCount: formatQuantity(actionCount),
  };
}

function mapAudit(source: PlatformAuditEntry): AuditEntry {
  return {
    id: String(source.id),
    tenantId: source.tenant_id ?? "",
    actor: `${source.actor_type}:${source.actor_id}`,
    action: source.action,
    target: source.resource ?? "Platform",
    source: source.outcome,
    time: formatTimestamp(source.created_at),
  };
}

function parseSnapshot(value: unknown): PlatformSnapshot {
  if (!isPlatformSnapshot(value)) throw new Error("Admin snapshot response is invalid");
  return value as unknown as PlatformSnapshot;
}

function isPlatformSnapshot(value: unknown): value is PlatformSnapshot {
  if (!isRecord(value)) return false;
  return isString(value.generated_at) && isNumber(value.audit_id) && isActor(value.actor) &&
    isArrayOf(value.tenants, isTenant) && isArrayOf(value.providers, isProvider) &&
    isArrayOf(value.connections, isConnection) && isArrayOf(value.actions, isAction) &&
    isArrayOf(value.usage, isUsage) && isArrayOf(value.audit, isAuditEntry);
}

function isActor(value: unknown) {
  if (!isRecord(value)) return false;
  return ["user", "service"].includes(String(value.kind)) && ["viewer", "operator", "admin"].includes(String(value.role));
}

function isTenant(value: unknown) {
  return hasStrings(value, ["id", "slug", "name", "status"]);
}

function isProvider(value: unknown) {
  return hasStrings(value, ["id", "display_name", "status"]);
}

function isConnection(value: unknown) {
  return hasStrings(value, ["id", "tenant_id", "provider_id", "name", "status", "updated_at"]);
}

function isAction(value: unknown) {
  return hasStrings(value, ["id", "tenant_id", "provider_id", "name", "status", "started_at"]) &&
    isRecord(value) && typeof value.retryable === "boolean";
}

function isUsage(value: unknown) {
  return hasStrings(value, ["tenant_id", "meter", "last_at"]) && isRecord(value) &&
    isNumber(value.quantity) && isNumber(value.cost_micros);
}

function isAuditEntry(value: unknown) {
  return hasStrings(value, ["actor_type", "actor_id", "action", "outcome", "created_at"]) &&
    isRecord(value) && isNumber(value.id);
}

function hasStrings(value: unknown, keys: string[]) {
  return isRecord(value) && keys.every((key) => isString(value[key]));
}

function isArrayOf(value: unknown, predicate: (item: unknown) => boolean) {
  return Array.isArray(value) && value.every(predicate);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metric(label: string, value: number, detail: string, tone: Tone) {
  return { label, value: formatQuantity(value), detail, tone };
}

function activeCount(items: Array<{ status: string }>) {
  return items.filter((item) => healthFromStatus(item.status) === "healthy").length;
}

function healthTone(items: Array<{ status: string }>): Tone {
  return items.some((item) => healthFromStatus(item.status) === "failed") ? "critical" : "positive";
}

function healthFromStatus(status: string): Health {
  if (["active", "healthy", "ready", "succeeded", "current"].includes(status.toLowerCase())) return "healthy";
  if (["failed", "disabled", "revoked", "unknown"].includes(status.toLowerCase())) return "failed";
  return "degraded";
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function hasConnectionID(action: PlatformAction): action is PlatformAction & { connection_id: string } {
  return typeof action.connection_id === "string" && action.connection_id.length > 0;
}

function sumUsageByTenant(items: PlatformUsage[]) {
  const sums = new Map<string, { costMicros: number }>();
  for (const item of items) {
    const current = sums.get(item.tenant_id) ?? { costMicros: 0 };
    current.costMicros += item.cost_micros;
    sums.set(item.tenant_id, current);
  }
  return sums;
}

function formatMoney(costMicros: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(costMicros / 1_000_000);
}

function formatQuantity(quantity: number) {
  return new Intl.NumberFormat("en-US").format(quantity);
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function validEdgeUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Admin edge URL must be an HTTPS origin");
  }
  return value.replace(/\/$/, "");
}

function requiredCredential(value: string, label: string) {
  if (!value || value.trim() !== value || value.length > 512) throw new Error(`Admin ${label} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
