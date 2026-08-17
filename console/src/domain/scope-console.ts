import type { ConsoleSnapshot, Metric, Tenant, UsageMeter } from "./console";

export function scopeConsoleSnapshot(snapshot: ConsoleSnapshot, tenantId: string): ConsoleSnapshot {
  if (!tenantId) return snapshot;

  const tenant = snapshot.tenants.find((candidate) => candidate.id === tenantId);
  if (!tenant) return emptySnapshot();

  const connections = snapshot.connections.filter((connection) => connection.tenantId === tenantId);
  const providerNames = new Set(connections.map((connection) => connection.provider));

  return {
    ...snapshot,
    metrics: scopeMetrics(snapshot.metrics, tenant),
    attention: snapshot.attention.filter((item) => item.tenantId === tenantId),
    providers: snapshot.providers.filter((provider) => providerNames.has(provider.name)),
    tenants: [tenant],
    connections,
    routes: snapshot.routes.filter((route) => route.tenantId === tenantId),
    events: snapshot.events.filter((event) => event.tenantId === tenantId),
    usage: scopeUsage(snapshot.usage, tenant),
    audit: snapshot.audit.filter((entry) => entry.tenantId === tenantId),
  };
}

function emptySnapshot(): ConsoleSnapshot {
  return { metrics: [], attention: [], providers: [], tenants: [], connections: [], routes: [], events: [], usage: [], audit: [] };
}

function scopeMetrics(metrics: Metric[], tenant: Tenant): Metric[] {
  return metrics.map((metric) => {
    if (metric.label === "Active tenants") return { ...metric, value: "1", detail: `${tenant.plan} plan sample` };
    if (metric.label === "Sample spend") return { ...metric, value: tenant.spend, detail: `${tenant.name} sample spend` };
    return { ...metric, detail: `${tenant.name} sample` };
  });
}

function scopeUsage(usage: UsageMeter[], tenant: Tenant): UsageMeter[] {
  return usage.map((meter) => {
    if (meter.label === "Action calls") return { ...meter, value: tenant.calls, detail: `${tenant.name} sample allowance` };
    if (meter.label === "Provider spend") return { ...meter, value: tenant.spend, detail: `${tenant.name} sample budget` };
    return { ...meter, detail: `${tenant.name} sample allowance` };
  });
}
