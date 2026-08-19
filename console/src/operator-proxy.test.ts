// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleOperatorRequest } from "../worker/operator-proxy";

const connectionID = "10000000-0000-4000-8000-000000000001";

describe("operator proxy", () => {
  it("forwards a bounded credential request without browser credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const forwarded = new Request(request);
      expect(forwarded.url).toBe("https://fde-api.paxtech.net/v1/operator/connections/instagram");
      expect(forwarded.headers.get("X-FDE-Access-Assertion")).toBe("signed-user-assertion");
      expect(forwarded.headers.get("Cookie")).toBeNull();
      expect(forwarded.headers.get("Authorization")).toBeNull();
      await expect(forwarded.text()).resolves.toContain("provider-token");
      return Response.json({ connection: { id: connectionID } }, { status: 201 });
    });
    const request = new Request("https://fde-console.paxtech.net/api/operator/connections/instagram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "session=value",
        Authorization: "Bearer browser-value",
      },
      body: JSON.stringify({ credential: { access_token: "provider-token", app_secret: "provider-secret" } }),
    });

    const response = await handleOperatorRequest(
      request,
      "signed-user-assertion",
      "https://fde-api.paxtech.net",
      fetcher,
    );

    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toEqual({ connection: { id: connectionID } });
  });

  it("forwards an exact connection check route", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      expect(new Request(request).url).toBe(
        `https://fde-api.paxtech.net/v1/operator/connections/${connectionID}/checks`,
      );
      return Response.json({ check: { id: "check-1", status: "succeeded" } });
    });
    const response = await handleOperatorRequest(
      new Request(`https://fde-console.paxtech.net/api/operator/connections/${connectionID}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: "tenant-1" }),
      }),
      "signed-user-assertion",
      "https://fde-api.paxtech.net",
      fetcher,
    );

    expect(response?.status).toBe(200);
  });

  it("fails closed for unsupported requests and unsafe configuration", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const cases = [
      new Request("https://fde-console.paxtech.net/api/operator/connections/instagram", { method: "GET" }),
      new Request("https://fde-console.paxtech.net/api/operator/connections/instagram?debug=true", { method: "POST" }),
      new Request("https://fde-console.paxtech.net/api/operator/connections/not-a-uuid/checks", { method: "POST" }),
    ];
    for (const request of cases) {
      const response = await handleOperatorRequest(request, "assertion", "https://fde-api.paxtech.net", fetcher);
      expect(response?.status).toBeGreaterThanOrEqual(400);
    }
    const invalid = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/operator/connections/instagram", { method: "POST" }),
      "assertion",
      "http://fde-api.paxtech.net",
      fetcher,
    );
    expect(invalid?.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a credential body larger than the bounded proxy limit", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/operator/connections/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: "a".repeat(33 * 1024) }),
      }),
      "signed-user-assertion",
      "https://fde-api.paxtech.net",
      fetcher,
    );

    expect(response?.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
