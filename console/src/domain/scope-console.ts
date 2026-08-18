import type { ConsoleSnapshot, Metric, Tenant, UsageMeter } from "./console";

export function scopeConsoleSnapshot(snapshot: ConsoleSnapshot, tenantId: string): ConsoleSnapshot {
  if (!tenantId) return snapshot;

  const tenant = snapshot.tenants.find((candidate) => candidate.id === tenantId);
  if (!tenant) return emptySnapshot(snapshot);

  const connections = snapshot.connections.filter((connection) => connection.tenantId === tenantId);
  const providerNames = new Set(connections.map((connection) => connection.provider));

  return {
    ...snapshot,
    metrics: scopeMetrics(snapshot, tenant),
    attention: snapshot.attention.filter((item) => item.tenantId === tenantId),
    providers: snapshot.providers.filter((provider) => providerNames.has(provider.id)),
    tenants: [tenant],
    connections,
    routes: snapshot.routes.filter((route) => route.tenantId === tenantId),
    events: snapshot.events.filter((event) => event.tenantId === tenantId),
    usage: scopeUsage(snapshot, tenant),
    audit: snapshot.audit.filter((entry) => entry.tenantId === tenantId),
  };
}

function emptySnapshot(snapshot: ConsoleSnapshot): ConsoleSnapshot {
  return { ...snapshot, metrics: [], attention: [], providers: [], tenants: [], connections: [], routes: [], events: [], usage: [], audit: [] };
}

function scopeMetrics(snapshot: ConsoleSnapshot, tenant: Tenant): Metric[] {
  return snapshot.metrics.map((metric) => {
    if (snapshot.mode === "live") return liveTenantMetric(metric, tenant);
    if (metric.label === "Active tenants") return { ...metric, value: "1", detail: `${tenant.name} sample` };
    if (metric.label === "Sample spend") return { ...metric, value: tenant.cost, detail: `${tenant.name} sample spend` };
    return { ...metric, detail: `${tenant.name} sample` };
  });
}

function liveTenantMetric(metric: Metric, tenant: Tenant): Metric {
  if (metric.label === "Tenants") return { ...metric, value: "1", detail: tenant.status };
  if (metric.label === "Connections") return { ...metric, value: String(tenant.connections), detail: `${tenant.name} connections` };
  if (metric.label === "Recent actions") return { ...metric, value: tenant.actions, detail: `${tenant.name} action metadata` };
  if (metric.label === "Recorded cost") return { ...metric, value: tenant.cost, detail: `${tenant.name} recorded cost` };
  return metric;
}

function scopeUsage(snapshot: ConsoleSnapshot, tenant: Tenant): UsageMeter[] {
  if (snapshot.mode === "live") return snapshot.usage.filter((meter) => meter.tenantId === tenant.id);
  return snapshot.usage.map((meter) => {
    if (meter.label === "Action calls") return { ...meter, value: tenant.actions, detail: `${tenant.name} sample allowance` };
    if (meter.label === "Provider spend") return { ...meter, value: tenant.cost, detail: `${tenant.name} sample budget` };
    return { ...meter, detail: `${tenant.name} sample allowance` };
  });
}
