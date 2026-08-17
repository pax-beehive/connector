"use client";

import { useState } from "react";
import { ConnectDialog } from "./components/connect-dialog";
import { Sidebar, Topbar } from "./components/navigation";
import type { ConsoleSnapshot, ViewId } from "./domain/console";
import { scopeConsoleSnapshot } from "./domain/scope-console";
import { AuditView } from "./views/audit";
import { ConnectorsView } from "./views/connectors";
import { EventsView } from "./views/events";
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
      <Sidebar active={view} open={sidebarOpen} onSelect={selectView} onClose={() => setSidebarOpen(false)} />
      <div className="workspace">
        <Topbar theme={theme} tenants={snapshot.tenants} tenantId={tenantId} onTenantChange={setTenantId} onThemeChange={() => setTheme(theme === "dark" ? "light" : "dark")} onMenu={() => setSidebarOpen(true)} />
        <main className="main-content">{renderView(view, visibleSnapshot, selectedTenant?.name, () => setConnectOpen(true))}</main>
      </div>
      {sidebarOpen ? <button className="sidebar-scrim" type="button" aria-label="Close navigation overlay" onClick={() => setSidebarOpen(false)} /> : null}
      {connectOpen && selectedTenant ? <ConnectDialog tenantName={selectedTenant.name} onClose={() => setConnectOpen(false)} /> : null}
    </div>
  );
}

function renderView(view: ViewId, snapshot: ConsoleSnapshot, tenantName: string | undefined, onConnect: () => void) {
  switch (view) {
    case "tenants":
      return <TenantsView tenants={snapshot.tenants} />;
    case "connectors":
      return <ConnectorsView connections={snapshot.connections} canConnect={Boolean(tenantName)} onConnect={onConnect} />;
    case "routing":
      return <RoutingView routes={snapshot.routes} />;
    case "events":
      return <EventsView events={snapshot.events} />;
    case "usage":
      return <UsageView usage={snapshot.usage} />;
    case "audit":
      return <AuditView entries={snapshot.audit} />;
    default:
      return <OverviewView snapshot={snapshot} />;
  }
}
