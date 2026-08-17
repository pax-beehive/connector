import { describe, expect, it } from "vitest";
import { prototypeRepository } from "./mock-console-repository";

describe("prototypeRepository", () => {
  it("returns a complete operational snapshot", async () => {
    const snapshot = await prototypeRepository.getSnapshot();

    expect(snapshot.metrics).toHaveLength(4);
    expect(snapshot.tenants.length).toBeGreaterThan(0);
    expect(snapshot.connections.length).toBeGreaterThan(0);
    expect(snapshot.routes.length).toBeGreaterThan(0);
    expect(snapshot.events.length).toBeGreaterThan(0);
    expect(snapshot.usage.length).toBeGreaterThan(0);
    expect(snapshot.audit.length).toBeGreaterThan(0);
  });
});
