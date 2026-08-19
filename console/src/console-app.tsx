"use client";

import { useState } from "react";
import { ConnectDialog } from "./components/connect-dialog";
import { Sidebar, Topbar } from "./components/navigation";
import type { ConsoleSnapshot, ViewId } from "./domain/console";
import { scopeConsoleSnapshot } from "./domain/scope-console";
import { AuditView } from "./views/audit";
import { ConnectorsView } from "./views/connectors";
import { EventsView } from "./views/events";
import { LlmView } from "./views/llm";
import { OverviewView } from "./views/overview";
import { RoutingView } from "./views/routing";
import { TenantsView } from "./views/tenants";
import { UsageView } from "./views/usage";

export function ConsoleApp({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const [view, setView] = useState<ViewId>("overview");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const selectedTenant = snapshot.tenants.find((tenant) => tenant.id === tenantId);
  const visibleSnapshot = scopeConsoleSnapshot(snapshot, tenantId);

  function selectView(nextView: ViewId) {
    setView(nextView);
    setSidebarOpen(false);
  }

  return (
    <div className="console-shell" data-theme={theme}>
      <Sidebar active={view} open={sidebarOpen} mode={snapshot.mode} actor={snapshot.actor} onSelect={selectView} onClose={() => setSidebarOpen(false)} />
      <div className="workspace">
        <Topbar theme={theme} mode={snapshot.mode} tenants={snapshot.tenants} tenantId={tenantId} onTenantChange={setTenantId} onThemeChange={() => setTheme(theme === "dark" ? "light" : "dark")} onMenu={() => setSidebarOpen(true)} />
        <main className="main-content">{renderView(view, visibleSnapshot, selectedTenant?.name, () => setConnectOpen(true))}</main>
      </div>
      {sidebarOpen ? <button className="sidebar-scrim" type="button" aria-label="Close navigation overlay" onClick={() => setSidebarOpen(false)} /> : null}
      {connectOpen && selectedTenant ? <ConnectDialog mode={snapshot.mode} tenantId={selectedTenant.id} tenantName={selectedTenant.name} onClose={() => setConnectOpen(false)} /> : null}
    </div>
  );
}

function renderView(view: ViewId, snapshot: ConsoleSnapshot, tenantName: string | undefined, onConnect: () => void) {
  switch (view) {
    case "tenants":
      return <TenantsView mode={snapshot.mode} tenants={snapshot.tenants} canCreate={snapshot.mode === "prototype" || snapshot.actor.role === "operator" || snapshot.actor.role === "admin"} />;
    case "connectors":
      return <ConnectorsView mode={snapshot.mode} connections={snapshot.connections} canConnect={Boolean(tenantName) && (snapshot.mode === "prototype" || snapshot.actor.role === "operator" || snapshot.actor.role === "admin")} hasTenant={Boolean(tenantName)} onConnect={onConnect} />;
    case "routing":
      return <RoutingView mode={snapshot.mode} routes={snapshot.routes} />;
    case "llm":
      return <LlmView mode={snapshot.mode} llmModels={snapshot.llmModels} llmRoutes={snapshot.llmRoutes} tenants={snapshot.tenants} canManage={snapshot.mode === "prototype" || snapshot.actor.role === "operator" || snapshot.actor.role === "admin"} />;
    case "events":
      return <EventsView mode={snapshot.mode} events={snapshot.events} />;
    case "usage":
      return <UsageView mode={snapshot.mode} usage={snapshot.usage} />;
    case "audit":
      return <AuditView mode={snapshot.mode} entries={snapshot.audit} />;
    default:
      return <OverviewView snapshot={snapshot} />;
  }
}
