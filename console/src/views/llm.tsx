import { Plus, Route } from "lucide-react";
import { useState } from "react";
import type { DataMode, LlmModel, LlmRoute, Tenant } from "../domain/console";
import { LlmModelDialog } from "../components/llm-model-dialog";
import { LlmRouteDialog } from "../components/llm-route-dialog";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

interface LlmViewProps {
  mode: DataMode;
  llmModels: LlmModel[];
  llmRoutes: LlmRoute[];
  tenants: Tenant[];
  canManage: boolean;
}

export function LlmView({ mode, llmModels, llmRoutes, tenants, canManage }: LlmViewProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const tenantName = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="LLM gateway"
        detail={mode === "live" ? "Enrolled models and routing policy from the platform admin API." : "Prototype LLM gateway models and routing policy."}
        action={
          <>
            <button className={canManage ? "button primary" : "button secondary"} type="button" disabled={!canManage} onClick={() => setModelOpen(true)}><Plus size={16} />Add model</button>
            <button className={canManage ? "button primary" : "button secondary"} type="button" disabled={!canManage} onClick={() => setRouteOpen(true)}><Route size={16} />Set route</button>
          </>
        }
      />
      <Panel title="Models" detail={`${llmModels.length} enrolled models`}>
        <div className="table-wrap">
          <table><thead><tr><th>Model</th><th>Provider</th><th>Endpoint</th><th>Status</th><th>Price in / out per MTok</th><th>Credential version</th></tr></thead>
            <tbody>{llmModels.map((model) => (
              <tr key={model.id}>
                <td><strong>{model.id}</strong></td>
                <td>{model.provider}</td>
                <td>{model.endpoint}</td>
                <td><HealthPill health={model.status} /></td>
                <td>{formatPrice(model.inCostMicrosPerMtok)} / {formatPrice(model.outCostMicrosPerMtok)}</td>
                <td>v{model.credentialVersion}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {llmModels.length === 0 ? <p className="empty-state">No models are enrolled yet.</p> : null}
      </Panel>
      <Panel title="Routes" detail={`${llmRoutes.length} routing policies`}>
        <div className="table-wrap">
          <table><thead><tr><th>Task class</th><th>Tenant</th><th>Targets</th><th>Version</th><th>Status</th></tr></thead>
            <tbody>{llmRoutes.map((route) => (
              <tr key={route.id}>
                <td><strong>{route.taskClass}</strong></td>
                <td>{route.tenantId ? tenantName.get(route.tenantId) ?? route.tenantId : "Global"}</td>
                <td>{route.targets.join(" → ")}</td>
                <td>v{route.version}</td>
                <td><HealthPill health={route.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {llmRoutes.length === 0 ? <p className="empty-state">No routes are configured yet.</p> : null}
      </Panel>
      {modelOpen ? <LlmModelDialog mode={mode} onClose={() => setModelOpen(false)} /> : null}
      {routeOpen ? <LlmRouteDialog mode={mode} tenants={tenants} models={llmModels} onClose={() => setRouteOpen(false)} /> : null}
    </>
  );
}

function formatPrice(microsPerMtok: number) {
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(microsPerMtok / 1_000_000)} / MTok`;
}
