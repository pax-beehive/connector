import type { ConsoleRepository, ConsoleSnapshot } from "../domain/console";

export const prototypeSnapshot: ConsoleSnapshot = {
  mode: "prototype",
  generatedAt: "",
  auditId: 0,
  actor: { kind: "service", role: "viewer" },
  metrics: [
    { label: "Active tenants", value: "18", detail: "+3 this month", tone: "positive" },
    { label: "Action success", value: "99.14%", detail: "+0.42% over 7 days", tone: "positive" },
    { label: "P95 latency", value: "428 ms", detail: "34 ms above target", tone: "warning" },
    { label: "Sample spend", value: "$2,840", detail: "62% of sample budget", tone: "neutral" },
  ],
  attention: [
    { id: "att-1", tenantId: "tenant-1", title: "Instagram token expires soon", detail: "Northstar Retail · 4 days remaining", time: "12 min ago", tone: "warning" },
    { id: "att-2", tenantId: "tenant-2", title: "Webhook retries exceeded", detail: "Acme Studios · messages.delivery", time: "28 min ago", tone: "critical" },
    { id: "att-3", tenantId: "tenant-3", title: "New tenant provisioned", detail: "Kite & Co · prototype", time: "1 hr ago", tone: "positive" },
  ],
  providers: [
    { id: "Instagram", name: "Instagram", status: "degraded", detail: "612 ms p95", window: "99.76% sample uptime" },
    { id: "OpenAI", name: "OpenAI", status: "healthy", detail: "341 ms p95", window: "99.99% sample uptime" },
    { id: "Anthropic", name: "Anthropic", status: "healthy", detail: "376 ms p95", window: "99.98% sample uptime" },
    { id: "Cloudflare", name: "Cloudflare", status: "healthy", detail: "82 ms p95", window: "100% sample uptime" },
  ],
  tenants: [
    { id: "tenant-1", name: "Northstar Retail", slug: "northstar-retail", status: "degraded", connections: 4, actions: "42.8k", cost: "$684" },
    { id: "tenant-2", name: "Acme Studios", slug: "acme-studios", status: "healthy", connections: 3, actions: "31.2k", cost: "$492" },
    { id: "tenant-3", name: "Kite & Co", slug: "kite-and-co", status: "healthy", connections: 2, actions: "18.7k", cost: "$306" },
    { id: "tenant-4", name: "Monarch Labs", slug: "monarch-labs", status: "failed", connections: 1, actions: "2.4k", cost: "$74" },
  ],
  connections: [
    { id: "conn-1", tenantId: "tenant-1", provider: "Instagram", account: "@northstar", tenant: "Northstar Retail", status: "degraded", lastActivity: "12 min ago", actionCount: "9.8k" },
    { id: "conn-2", tenantId: "tenant-2", provider: "Instagram", account: "@acmecreates", tenant: "Acme Studios", status: "healthy", lastActivity: "2 min ago", actionCount: "7.4k" },
    { id: "conn-3", tenantId: "tenant-1", provider: "OpenAI", account: "Sample project", tenant: "Northstar Retail", status: "healthy", lastActivity: "Sample", actionCount: "42.8k" },
    { id: "conn-4", tenantId: "tenant-3", provider: "Anthropic", account: "Sample workspace", tenant: "Kite & Co", status: "healthy", lastActivity: "Sample", actionCount: "18.7k" },
  ],
  routes: [
    { id: "route-1", tenantId: "tenant-1", tenant: "Northstar Retail", useCase: "Customer support", primary: "gpt-5.2", fallback: "claude-sonnet-4", status: "healthy" },
    { id: "route-2", tenantId: "tenant-2", tenant: "Acme Studios", useCase: "Content moderation", primary: "gpt-5-mini", fallback: "claude-haiku-4", status: "healthy" },
    { id: "route-3", tenantId: "tenant-3", tenant: "Kite & Co", useCase: "Long-form analysis", primary: "claude-opus-4", fallback: "gpt-5.2", status: "degraded" },
  ],
  events: [
    { id: "evt_01JYA8R9", tenantId: "tenant-1", topic: "instagram.message.received", tenant: "Northstar Retail", status: "healthy", attempts: 1, receivedAt: "00:48:22" },
    { id: "evt_01JYA8P4", tenantId: "tenant-2", topic: "instagram.comment.created", tenant: "Acme Studios", status: "healthy", attempts: 1, receivedAt: "00:47:58" },
    { id: "evt_01JYA8M1", tenantId: "tenant-2", topic: "messages.delivery", tenant: "Acme Studios", status: "failed", attempts: 5, receivedAt: "00:46:19" },
    { id: "evt_01JYA8H7", tenantId: "tenant-3", topic: "connector.credential.rotated", tenant: "Kite & Co", status: "healthy", attempts: 1, receivedAt: "00:44:03" },
  ],
  usage: [
    { tenantId: "", label: "Action calls", value: "96.4k", detail: "150k monthly allowance", progress: 64, tone: "positive" },
    { tenantId: "", label: "LLM tokens", value: "28.7M", detail: "40M monthly allowance", progress: 72, tone: "warning" },
    { tenantId: "", label: "Provider spend", value: "$2,840", detail: "$4,500 monthly budget", progress: 62, tone: "neutral" },
  ],
  audit: [
    { id: "aud-1", tenantId: "tenant-1", actor: "example.operator@pax.invalid", action: "connection.rotate", target: "Instagram · Northstar Retail", source: "Access adapter", time: "00:36:14" },
    { id: "aud-2", tenantId: "tenant-2", actor: "platform-scheduler", action: "event.backfill", target: "Acme Studios · messages.delivery", source: "Cloud Run job", time: "00:22:08" },
    { id: "aud-3", tenantId: "tenant-3", actor: "example.operator@pax.invalid", action: "route.publish", target: "Long-form analysis · v12", source: "Access adapter", time: "Yesterday" },
    { id: "aud-4", tenantId: "tenant-3", actor: "tenant-admin", action: "api_key.create", target: "Kite & Co · prototype", source: "Tenant console", time: "Yesterday" },
  ],
};

export const prototypeRepository: ConsoleRepository = {
  async getSnapshot() {
    return prototypeSnapshot;
  },
};
