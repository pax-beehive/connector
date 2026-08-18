import type { DataMode, ModelRoute } from "../domain/console";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

export function RoutingView({ mode, routes }: { mode: DataMode; routes: ModelRoute[] }) {
  const live = mode === "live";
  return (
    <>
      <PageHeader eyebrow="Model gateway" title="Routing control" detail={live ? "Routing policy metadata is not exposed by the current read-only admin API." : "Sample model policies with explicit fallbacks and health-aware execution."} action={<button className="button secondary" type="button" disabled>Routing API pending</button>} />
      <div className="content-grid routing-layout">
        <Panel title={live ? "Routes" : "Sample routes"} detail={live ? "Routing API pending" : "Prototype version 12"}>
          <div className="route-list">{routes.map((route) => <article className="route-row" key={route.id}><div><strong>{route.useCase}</strong><span>{route.tenant} · {route.primary} <b>then</b> {route.fallback}</span></div><HealthPill health={route.status} /></article>)}</div>
          {routes.length === 0 ? <p className="empty-state">Routing policy API pending.</p> : null}
        </Panel>
        <Panel title={live ? "Routing boundary" : "Execution guardrails"} detail={live ? "Read-only API status" : "Prototype policy"}>
          {live ? <div className="policy-row"><span>Route inspection</span><strong>API not implemented</strong></div> : <>
          <div className="policy-row"><span>Request timeout</span><strong>20 seconds</strong></div>
          <div className="policy-row"><span>Safe retries</span><strong>Up to 3 attempts</strong></div>
          <div className="policy-row"><span>Unsafe mutations</span><strong>Single attempt</strong></div>
          <div className="policy-row"><span>Result handling</span><strong>Encrypted ledger</strong></div>
          </>}
        </Panel>
      </div>
    </>
  );
}
