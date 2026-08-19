import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleApp } from "./console-app";
import { prototypeSnapshot } from "./data/mock-console-repository";

function openLlmView() {
  fireEvent.click(screen.getByRole("button", { name: "LLM gateway" }));
  expect(screen.getByRole("heading", { name: "LLM gateway" })).toBeVisible();
}

describe("LLM gateway view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the enrolled models and routes tables from the snapshot", () => {
    render(<ConsoleApp snapshot={prototypeSnapshot} />);
    openLlmView();

    expect(screen.getByRole("cell", { name: "openai" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "https://api.deepseek.com" })).toBeVisible();
    expect(screen.getAllByText(/\$1\.25 \/ MTok/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("cell", { name: "v2" })).toHaveLength(2);

    expect(screen.getByRole("cell", { name: "default" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "Global" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "Northstar Retail" })).toBeVisible();
    expect(screen.getByText("openai/gpt-5 → deepseek/deepseek-chat")).toBeVisible();
  });

  it("keeps model enrollment and routing disabled for a live viewer", () => {
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "viewer" },
    }} />);
    openLlmView();

    expect(screen.getByRole("button", { name: "Add model" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set route" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the prototype dialogs without modifying data", () => {
    render(<ConsoleApp snapshot={prototypeSnapshot} />);
    openLlmView();

    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    expect(screen.getByRole("dialog", { name: "Add model" })).toBeVisible();
    expect(screen.getByText("Prototype model enrollment")).toBeVisible();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Set route" }));
    expect(screen.getByRole("dialog", { name: "Set route" })).toBeVisible();
    expect(screen.getByText("Prototype route configuration")).toBeVisible();
  });

  it("lets a live operator enroll a model with the contracted payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      request_id: "req-1",
      model: { id: "openai/gpt-5", provider: "openai", endpoint: "https://api.openai.com", status: "active" },
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "operator" },
    }} />);
    openLlmView();
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));

    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "gpt-5" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    fireEvent.change(screen.getByLabelText("Input price (micros per MTok)"), { target: { value: "1250000" } });
    fireEvent.change(screen.getByLabelText("Output price (micros per MTok)"), { target: { value: "10000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enroll model" }));

    await waitFor(() => expect(screen.getByText("Model enrolled")).toBeVisible());
    expect(fetcher).toHaveBeenCalledWith("/api/admin/llm/models", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        id: "openai/gpt-5",
        provider: "openai",
        endpoint: "https://api.openai.com",
        api_key: "sk-test",
        in_cost_micros_per_mtok: 1250000,
        out_cost_micros_per_mtok: 10000000,
      }),
    }));
  });

  it("surfaces a model id conflict when the admin API rejects enrollment", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      error: { kind: "llm_model_conflict" },
    }, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "admin" },
    }} />);
    openLlmView();
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));

    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "gpt-5" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    fireEvent.change(screen.getByLabelText("Input price (micros per MTok)"), { target: { value: "1250000" } });
    fireEvent.change(screen.getByLabelText("Output price (micros per MTok)"), { target: { value: "10000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enroll model" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("that model id is already enrolled"));
    expect(screen.queryByText("Model enrolled")).not.toBeInTheDocument();
  });

  it("lets a live operator save a route with ordered targets", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      request_id: "req-2",
      route: { id: "route-9", task_class: "default", targets: ["deepseek/deepseek-chat", "openai/gpt-5"], version: 5 },
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "operator" },
    }} />);
    openLlmView();
    fireEvent.click(screen.getByRole("button", { name: "Set route" }));
    const dialog = screen.getByRole("dialog", { name: "Set route" });

    fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: "deepseek/deepseek-chat" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add target" }));
    fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: "openai/gpt-5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add target" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save route" }));

    await waitFor(() => expect(screen.getByText("Route saved")).toBeVisible());
    expect(fetcher).toHaveBeenCalledWith("/api/admin/llm/routes", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        task_class: "default",
        targets: ["deepseek/deepseek-chat", "openai/gpt-5"],
      }),
    }));
  });

  it("sends the tenant scope and surfaces invalid route configurations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      error: { kind: "invalid_request" },
    }, { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ConsoleApp snapshot={{
      ...prototypeSnapshot,
      mode: "live",
      actor: { kind: "user", role: "operator" },
    }} />);
    openLlmView();
    fireEvent.click(screen.getByRole("button", { name: "Set route" }));
    const dialog = screen.getByRole("dialog", { name: "Set route" });

    fireEvent.change(within(dialog).getByLabelText("Task class"), { target: { value: "chat" } });
    fireEvent.change(within(dialog).getByLabelText("Tenant"), { target: { value: "tenant-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add target" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save route" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("the route configuration is invalid"));
    expect(fetcher).toHaveBeenCalledWith("/api/admin/llm/routes", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        task_class: "chat",
        targets: ["openai/gpt-5"],
        tenant_id: "tenant-1",
      }),
    }));
    expect(screen.queryByText("Route saved")).not.toBeInTheDocument();
  });
});
