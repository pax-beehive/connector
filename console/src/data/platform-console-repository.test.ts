import { describe, expect, it, vi } from "vitest";
import { PlatformConsoleRepository } from "./platform-console-repository";

describe("PlatformConsoleRepository", () => {
  it("maps the authenticated metadata snapshot into the console domain", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      generated_at: "2026-08-18T03:04:31Z",
      audit_id: 9,
      actor: { id: "actor-1", kind: "service", subject: "service.access", role: "viewer" },
      tenants: [{
        id: "tenant-1",
        slug: "pax-fde-prod",
        name: "PAX FDE Production",
        status: "active",
        created_at: "2026-08-17T00:00:00Z",
        updated_at: "2026-08-18T00:00:00Z",
      }],
      providers: [{ id: "instagram", display_name: "Instagram", status: "active" }],
      connections: [{
        id: "connection-1",
        tenant_id: "tenant-1",
        provider_id: "instagram",
        name: "Primary",
        is_default: true,
        status: "active",
        created_at: "2026-08-17T01:00:00Z",
        updated_at: "2026-08-18T01:00:00Z",
      }],
      actions: [{
        id: "action-1",
        tenant_id: "tenant-1",
        requested_connection_id: "connection-1",
        connection_id: "connection-1",
        provider_id: "instagram",
        name: "media.list",
        status: "succeeded",
        retryable: false,
        started_at: "2026-08-18T02:00:00Z",
        completed_at: "2026-08-18T02:00:01Z",
      }],
      usage: [{
        tenant_id: "tenant-1",
        meter: "actions.calls",
        quantity: 3,
        cost_micros: 120000,
        last_at: "2026-08-18T02:00:01Z",
      }],
      audit: [{
        id: 8,
        tenant_id: "tenant-1",
        actor_type: "platform_key",
        actor_id: "key-prefix",
        action: "action.invoke",
        resource: "action-1",
        outcome: "succeeded",
        created_at: "2026-08-18T02:00:01Z",
      }],
      llm_models: [{
        id: "openai/gpt-5",
        provider: "openai",
        endpoint: "https://api.openai.com",
        status: "active",
        in_cost_micros_per_mtok: 1250000,
        out_cost_micros_per_mtok: 10000000,
        credential_version: 2,
      }],
      llm_routes: [{
        id: "route-1",
        tenant_id: null,
        task_class: "default",
        targets: ["openai/gpt-5", "deepseek/deepseek-chat"],
        version: 4,
        status: "active",
      }, {
        id: "route-2",
        tenant_id: "tenant-1",
        task_class: "chat",
        targets: ["anthropic/claude-sonnet-4-5"],
        version: 2,
        status: "disabled",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const repository = new PlatformConsoleRepository({
      edgeUrl: "https://admin.example.com",
      clientId: "client.access",
      clientSecret: "secret-value",
      accessAssertion: "signed-user-assertion",
      fetcher,
    });

    const snapshot = await repository.getSnapshot();

    expect(fetcher).toHaveBeenCalledWith(
      "https://admin.example.com/v1/admin/snapshot",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          "CF-Access-Client-Id": "client.access",
          "CF-Access-Client-Secret": "secret-value",
          Authorization: "Bearer signed-user-assertion",
        }),
      }),
    );
    expect(snapshot.mode).toBe("live");
    expect(snapshot.actor).toEqual({ kind: "service", role: "viewer" });
    expect(snapshot.metrics.map((metric) => metric.value)).toEqual(["1", "1", "1", "$0.12"]);
    expect(snapshot.tenants[0]).toMatchObject({
      id: "tenant-1",
      connections: 1,
      actions: "1",
      cost: "$0.12",
    });
    expect(snapshot.connections[0]).toMatchObject({ actionCount: "1", tenant: "PAX FDE Production" });
    expect(snapshot.audit[0]).toMatchObject({ action: "action.invoke", target: "action-1" });
    expect(snapshot.llmModels[0]).toEqual({
      id: "openai/gpt-5",
      provider: "openai",
      endpoint: "https://api.openai.com",
      status: "healthy",
      inCostMicrosPerMtok: 1250000,
      outCostMicrosPerMtok: 10000000,
      credentialVersion: 2,
    });
    expect(snapshot.llmRoutes[0]).toEqual({
      id: "route-1",
      tenantId: null,
      taskClass: "default",
      targets: ["openai/gpt-5", "deepseek/deepseek-chat"],
      version: 4,
      status: "healthy",
    });
    expect(snapshot.llmRoutes[1]).toMatchObject({ tenantId: "tenant-1", taskClass: "chat", status: "failed" });
  });

  it("rejects a snapshot without the llm gateway fields", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      generated_at: "2026-08-18T03:04:31Z",
      audit_id: 9,
      actor: { kind: "service", role: "viewer" },
      tenants: [], providers: [], connections: [], actions: [], usage: [], audit: [],
    }), { status: 200 }));
    const repository = new PlatformConsoleRepository({
      edgeUrl: "https://admin.example.com",
      clientId: "client.access",
      clientSecret: "secret-value",
      fetcher,
    });

    await expect(repository.getSnapshot()).rejects.toThrow("Admin snapshot response is invalid");
  });

  it("rejects malformed metadata instead of widening authority or rendering partial records", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      generated_at: "2026-08-18T03:04:31Z",
      audit_id: 9,
      actor: { kind: "service", role: "owner" },
      tenants: [], providers: [], connections: [], actions: [], usage: [], audit: [],
    }), { status: 200 }));
    const repository = new PlatformConsoleRepository({
      edgeUrl: "https://admin.example.com",
      clientId: "client.access",
      clientSecret: "secret-value",
      fetcher,
    });

    await expect(repository.getSnapshot()).rejects.toThrow("Admin snapshot response is invalid");
  });

  it("rejects redirects without relying on an unsupported edge redirect mode", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://unexpected.example.com" },
    }));
    const repository = new PlatformConsoleRepository({
      edgeUrl: "https://admin.example.com",
      clientId: "client.access",
      clientSecret: "secret-value",
      fetcher,
    });

    await expect(repository.getSnapshot()).rejects.toThrow("Admin snapshot request failed with status 302");
    expect(fetcher).toHaveBeenCalledWith(
      "https://admin.example.com/v1/admin/snapshot",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
