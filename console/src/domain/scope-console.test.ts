import { describe, expect, it } from "vitest";
import { prototypeSnapshot } from "../data/mock-console-repository";
import { scopeConsoleSnapshot } from "./scope-console";

describe("scopeConsoleSnapshot", () => {
  it("fails closed for an unknown tenant context", () => {
    const scoped = scopeConsoleSnapshot(prototypeSnapshot, "unknown-tenant");

    expect(scoped.metrics).toHaveLength(0);
    expect(scoped.tenants).toHaveLength(0);
    expect(scoped.connections).toHaveLength(0);
    expect(scoped.events).toHaveLength(0);
    expect(scoped.audit).toHaveLength(0);
  });

  it("keeps the explicit all-tenant context available", () => {
    expect(scopeConsoleSnapshot(prototypeSnapshot, "")).toBe(prototypeSnapshot);
  });

  it("scopes live usage by stable tenant id", () => {
    const liveSnapshot = {
      ...prototypeSnapshot,
      mode: "live" as const,
      usage: [
        { tenantId: "tenant-1", label: "Northstar usage", value: "2", detail: "$0.02", tone: "neutral" as const },
        { tenantId: "tenant-2", label: "Acme usage", value: "3", detail: "$0.03", tone: "neutral" as const },
      ],
    };

    expect(scopeConsoleSnapshot(liveSnapshot, "tenant-2").usage.map((meter) => meter.label)).toEqual(["Acme usage"]);
  });

  it("relates provider health by stable provider id instead of display name", () => {
    const liveSnapshot = {
      ...prototypeSnapshot,
      mode: "live" as const,
      providers: [{ id: "instagram", name: "Instagram", status: "healthy" as const, detail: "active", window: "Current metadata" }],
      connections: [{ ...prototypeSnapshot.connections[0], provider: "instagram" }],
    };

    expect(scopeConsoleSnapshot(liveSnapshot, "tenant-1").providers.map((provider) => provider.name)).toEqual(["Instagram"]);
  });
});
