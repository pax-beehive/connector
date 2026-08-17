import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsoleApp } from "./console-app";
import { prototypeSnapshot } from "./data/mock-console-repository";

function renderConsole() {
  return render(<ConsoleApp snapshot={prototypeSnapshot} />);
}

describe("ConsoleApp", () => {
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
});
