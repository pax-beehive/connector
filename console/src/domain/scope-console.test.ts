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
});
