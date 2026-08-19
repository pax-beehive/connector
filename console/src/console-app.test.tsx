import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleApp } from "./console-app";
import { prototypeSnapshot } from "./data/mock-console-repository";

function renderConsole() {
  return render(<ConsoleApp snapshot={prototypeSnapshot} />);
}

describe("ConsoleApp", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("lets an operator move from the overview to the tenant workspace", () => {
    renderConsole();

    expect(screen.getByRole("heading", { name: "Operational overview" })).toBeVisible();
    expect(screen.getByText("Prototype data")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));

    expect(screen.getByRole("heading", { name: "Tenant operations" })).toBeVisible();
  });

  it("exposes every operational workspace from the primary navigation", () => {
    renderConsole();

    const workspaces = [
      ["Connectors", "Connector fleet"],
      ["LLM routing", "Routing control"],
      ["Events", "Event delivery"],
      ["Usage and cost", "Usage and cost"],
      ["Audit log", "Audit log"],
    ];

    for (const [button, heading] of workspaces) {
      fireEvent.click(screen.getByRole("button", { name: button }));
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  it("filters the tenant directory by name or slug", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Search tenants" }), {
      target: { value: "monarch" },
    });

    expect(screen.getByRole("cell", { name: /Monarch Labs/ })).toBeVisible();
    expect(screen.queryByRole("cell", { name: /Northstar Retail/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search tenants" }), {
      target: { value: "missing tenant" },
    });
    expect(screen.getByText("No tenants match this search.")).toBeVisible();
  });

  it("walks through the provider connection framework without collecting secrets", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    expect(screen.getByRole("button", { name: "Select tenant to connect" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Tenant context" }), {
      target: { value: "tenant-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

    expect(screen.getByRole("dialog", { name: "Connect provider" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/ }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Authorize Anthropic" })).toBeVisible();
    expect(screen.getByText("This framework does not collect secrets.", { exact: false })).toBeVisible();
    expect(within(screen.getByRole("dialog")).getByText("Kite & Co")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close connection dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies tenant context to every tenant-sensitive workspace", () => {
    renderConsole();
    fireEvent.change(screen.getByRole("combobox", { name: "Tenant context" }), {
      target: { value: "tenant-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    expect(within(screen.getByRole("main")).getAllByText("Acme Studios").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("main")).queryByText("Northstar Retail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "LLM routing" }));
    expect(screen.getByText("Content moderation")).toBeVisible();
    expect(screen.queryByText("Customer support")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(within(screen.getByRole("main")).getAllByText("Acme Studios").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("main")).queryByText("Northstar Retail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usage and cost" }));
    expect(screen.getAllByText(/Acme Studios sample/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Audit log" }));
    expect(within(screen.getByRole("main")).getByText(/Acme Studios/)).toBeVisible();
    expect(within(screen.getByRole("main")).queryByText(/Northstar Retail/)).not.toBeInTheDocument();
  });

  it("supports theme and compact-navigation controls", () => {
    const { container } = renderConsole();
    const shell = container.querySelector(".console-shell");

    expect(shell).toHaveAttribute("data-theme", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(shell).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(container.querySelector(".sidebar")).toHaveClass("sidebar-open");
    fireEvent.click(screen.getByRole("button", { name: "Close navigation overlay" }));
    expect(container.querySelector(".sidebar")).not.toHaveClass("sidebar-open");
  });

  it("labels live metadata truthfully and keeps unavailable mutations disabled", () => {
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      generatedAt: "2026-08-18T03:04:31Z",
      auditId: 9,
      attention: [],
      routes: [],
      events: [],
      usage: [{ tenantId: "tenant-1", label: "Northstar · actions.calls", value: "3", detail: "$0.12 recorded", tone: "neutral" }],
    }} />);

    expect(screen.getByText("Live metadata")).toBeVisible();
    expect(screen.getByText("Production")).toBeVisible();
    expect(screen.queryByText("Prototype data")).not.toBeInTheDocument();
    expect(screen.getByText("No action metadata currently needs attention.")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Tenant context" }), {
      target: { value: "tenant-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    expect(screen.getByRole("button", { name: "Operator access required" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByText("Event metadata API pending.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "LLM routing" }));
    expect(screen.getByText("Routing policy API pending.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Usage and cost" }));
    expect(screen.getByText("Action ledger aggregates")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Audit log" }));
    expect(screen.getByText("Recorded activity")).toBeVisible();
  });

  it("offers the prototype tenant creation framework without modifying data", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));

    fireEvent.click(screen.getByRole("button", { name: "Add tenant" }));

    expect(screen.getByRole("dialog", { name: "Add tenant" })).toBeVisible();
    expect(screen.getByText("Prototype tenant creation")).toBeVisible();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps tenant creation disabled for a live viewer", () => {
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "viewer" },
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));

    expect(screen.getByRole("button", { name: "Add tenant" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a live operator create a tenant and shows the registered metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      request_id: "req-1",
      tenant: { id: "tenant-9", slug: "northstar-retail", name: "Northstar Retail", status: "active" },
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "operator" },
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tenant" }));

    fireEvent.change(screen.getByLabelText("Tenant name"), { target: { value: "Northstar Retail" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "northstar-retail" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tenant" }));

    await waitFor(() => expect(screen.getByText("Tenant created")).toBeVisible());
    const dialog = screen.getByRole("dialog", { name: "Add tenant" });
    expect(within(dialog).getByText("northstar-retail")).toBeVisible();
    expect(within(dialog).getByText("active")).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith("/api/admin/tenants", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ slug: "northstar-retail", name: "Northstar Retail" }),
    }));
  });

  it("surfaces a slug conflict when the admin API rejects the tenant", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      error: { kind: "tenant_conflict" },
    }, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "admin" },
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tenant" }));

    fireEvent.change(screen.getByLabelText("Tenant name"), { target: { value: "Northstar Retail" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "northstar-retail" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tenant" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("that slug is already taken"));
    expect(screen.queryByText("Tenant created")).not.toBeInTheDocument();
  });

  it("lets a live operator save and test an Instagram credential without redisplaying secrets", async () => {
    const connectionID = "10000000-0000-4000-8000-000000000001";
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connection: {
        id: connectionID,
        tenant_id: "tenant-1",
        provider_id: "instagram",
        name: "Test Instagram",
        external_account_id: "ig-user-1",
        status: "active",
      } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ check: {
        id: "check-1",
        connection_id: connectionID,
        status: "succeeded",
        latency_ms: 42,
        retryable: false,
        checked_at: "2026-08-18T12:00:00Z",
      } }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "operator" },
      generatedAt: "2026-08-18T03:04:31Z",
      auditId: 10,
    }} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Tenant context" }), {
      target: { value: "tenant-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

    fireEvent.change(screen.getByLabelText("Connection name"), { target: { value: "Test Instagram" } });
    fireEvent.change(screen.getByLabelText("Instagram account ID"), { target: { value: "ig-user-1" } });
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "provider-token" } });
    fireEvent.change(screen.getByLabelText("App secret"), { target: { value: "provider-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    await waitFor(() => expect(screen.getByText("Connection succeeded")).toBeVisible());
    expect(screen.getByText("42 ms")).toBeVisible();
    expect(screen.queryByDisplayValue("provider-token")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("provider-secret")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/operator/connections/instagram", expect.objectContaining({
      method: "POST",
    }));
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/operator/connections/${connectionID}/checks`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
