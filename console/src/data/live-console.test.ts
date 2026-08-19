import { describe, expect, it, vi } from "vitest";
import { verifiedAccessAssertionHeader } from "../access-boundary";
import { loadConsoleSnapshot } from "./live-console";

const liveEnvironment = {
  CONSOLE_DATA_MODE: "live",
  ADMIN_EDGE_URL: "https://fde-console-api.paxtech.net",
  CF_ACCESS_CLIENT_ID: "client-id",
  CF_ACCESS_CLIENT_SECRET: "client-secret",
};

describe("loadConsoleSnapshot", () => {
  it("keeps the local default on explicit prototype data", async () => {
    const snapshot = await loadConsoleSnapshot({ requestHeaders: new Headers(), environment: {} });

    expect(snapshot.mode).toBe("prototype");
  });

  it("fails closed before requesting live data when Sites identity is absent", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(loadConsoleSnapshot({
      requestHeaders: new Headers(),
      environment: liveEnvironment,
      fetcher,
    })).rejects.toThrow("Authenticated Sites identity is required");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads live metadata only after Sites identity is present", async () => {
    const requestHeaders = new Headers({ "oai-authenticated-user-id": "owner-1" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(platformSnapshot()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const snapshot = await loadConsoleSnapshot({ requestHeaders, environment: liveEnvironment, fetcher });

    expect(snapshot.mode).toBe("live");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("loads live metadata after the Worker verifies Cloudflare Access", async () => {
    const requestHeaders = new Headers({ [verifiedAccessAssertionHeader]: "verified-by-worker" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(platformSnapshot()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const snapshot = await loadConsoleSnapshot({
      requestHeaders,
      environment: { ...liveEnvironment, CONSOLE_AUTH_MODE: "cloudflare_access" },
      fetcher,
    });

    expect(snapshot.mode).toBe("live");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://fde-console-api.paxtech.net/v1/admin/snapshot",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer verified-by-worker" }),
      }),
    );
  });

  it("rejects unknown data modes instead of widening to prototype data", async () => {
    await expect(loadConsoleSnapshot({
      requestHeaders: new Headers(),
      environment: { CONSOLE_DATA_MODE: "production" },
    })).rejects.toThrow("Console data mode is invalid");
  });
});

function platformSnapshot() {
  return {
    generated_at: "2026-08-18T01:00:00Z",
    audit_id: 9,
    actor: { kind: "service", role: "viewer" },
    tenants: [],
    providers: [],
    connections: [],
    actions: [],
    usage: [],
    audit: [],
    llm_models: [],
    llm_routes: [],
  };
}
