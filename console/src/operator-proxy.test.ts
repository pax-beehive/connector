// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleOperatorRequest } from "../worker/operator-proxy";

const connectionID = "10000000-0000-4000-8000-000000000001";
const platformEdge = "https://fde-api.paxtech.net";
const adminEdge = "https://fde-console-api.paxtech.net";

describe("operator proxy", () => {
  it("forwards a bounded credential request without browser credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const forwarded = new Request(request);
      expect(forwarded.url).toBe("https://fde-api.paxtech.net/v1/operator/connections/instagram");
      expect(forwarded.headers.get("Cf-Access-Jwt-Assertion")).toBe("signed-user-assertion");
      expect(forwarded.headers.get("X-FDE-Access-Assertion")).toBeNull();
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
      platformEdge,
      adminEdge,
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
      platformEdge,
      adminEdge,
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
      const response = await handleOperatorRequest(request, "assertion", platformEdge, adminEdge, fetcher);
      expect(response?.status).toBeGreaterThanOrEqual(400);
    }
    const invalid = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/operator/connections/instagram", { method: "POST" }),
      "assertion",
      "http://fde-api.paxtech.net",
      adminEdge,
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
      platformEdge,
      adminEdge,
      fetcher,
    );

    expect(response?.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("admin proxy", () => {
  it("forwards a create tenant request to the admin edge", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const forwarded = new Request(request);
      expect(forwarded.url).toBe("https://fde-console-api.paxtech.net/v1/admin/tenants");
      expect(forwarded.headers.get("Cf-Access-Jwt-Assertion")).toBe("signed-user-assertion");
      expect(forwarded.headers.get("Cookie")).toBeNull();
      expect(forwarded.headers.get("Authorization")).toBeNull();
      await expect(forwarded.text()).resolves.toContain("northstar-retail");
      return Response.json({ tenant: { id: "tenant-9", slug: "northstar-retail", name: "Northstar Retail", status: "active" } }, { status: 201 });
    });
    const response = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/tenants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "session=value",
        },
        body: JSON.stringify({ slug: "northstar-retail", name: "Northstar Retail" }),
      }),
      "signed-user-assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );

    expect(response?.status).toBe(201);
  });

  it("fails closed for unsupported admin requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const cases = [
      new Request("https://fde-console.paxtech.net/api/admin/tenants", { method: "GET" }),
      new Request("https://fde-console.paxtech.net/api/admin/tenants?debug=true", { method: "POST" }),
      new Request("https://fde-console.paxtech.net/api/admin/unknown", { method: "POST" }),
    ];
    for (const request of cases) {
      const response = await handleOperatorRequest(request, "assertion", platformEdge, adminEdge, fetcher);
      expect(response?.status).toBeGreaterThanOrEqual(400);
    }
    const notFound = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/unknown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      "assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );
    expect(notFound?.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a JSON content type for create tenant requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "slug=northstar-retail",
      }),
      "signed-user-assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );

    expect(response?.status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards llm model enrollment to the admin edge", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const forwarded = new Request(request);
      expect(forwarded.url).toBe("https://fde-console-api.paxtech.net/v1/admin/llm/models");
      expect(forwarded.headers.get("Cf-Access-Jwt-Assertion")).toBe("signed-user-assertion");
      await expect(forwarded.text()).resolves.toContain("openai/gpt-5");
      return Response.json({ request_id: "req-1", model: { id: "openai/gpt-5", provider: "openai", endpoint: "https://api.openai.com", status: "active" } }, { status: 201 });
    });
    const response = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "openai/gpt-5", provider: "openai", endpoint: "https://api.openai.com", api_key: "sk-test", in_cost_micros_per_mtok: 1250000, out_cost_micros_per_mtok: 10000000 }),
      }),
      "signed-user-assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );

    expect(response?.status).toBe(201);
  });

  it("forwards llm route updates to the admin edge", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const forwarded = new Request(request);
      expect(forwarded.url).toBe("https://fde-console-api.paxtech.net/v1/admin/llm/routes");
      expect(forwarded.headers.get("Cf-Access-Jwt-Assertion")).toBe("signed-user-assertion");
      await expect(forwarded.text()).resolves.toContain("task_class");
      return Response.json({ request_id: "req-2", route: { id: "route-1", task_class: "default", targets: ["openai/gpt-5"], version: 5 } }, { status: 201 });
    });
    const response = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/llm/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_class: "default", targets: ["openai/gpt-5"] }),
      }),
      "signed-user-assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );

    expect(response?.status).toBe(201);
  });

  it("fails closed for unsupported llm admin requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const wrongMethod = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/llm/models", { method: "GET" }),
      "assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );
    expect(wrongMethod?.status).toBe(405);

    const unknown = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/llm/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      "assertion",
      platformEdge,
      adminEdge,
      fetcher,
    );
    expect(unknown?.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed when the admin edge is not configured", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleOperatorRequest(
      new Request("https://fde-console.paxtech.net/api/admin/tenants", { method: "POST" }),
      "assertion",
      platformEdge,
      undefined,
      fetcher,
    );

    expect(response?.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
