import type { ModelRoute } from "../domain/console";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

export function RoutingView({ routes }: { routes: ModelRoute[] }) {
  return (
    <>
      <PageHeader eyebrow="Model gateway" title="Routing control" detail="Sample model policies with explicit fallbacks and health-aware execution." action={<button className="button secondary" type="button" disabled>Routing API pending</button>} />
      <div className="content-grid routing-layout">
        <Panel title="Sample routes" detail="Prototype version 12">
          <div className="route-list">{routes.map((route) => <article className="route-row" key={route.id}><div><strong>{route.useCase}</strong><span>{route.tenant} · {route.primary} <b>then</b> {route.fallback}</span></div><HealthPill health={route.status} /></article>)}</div>
        </Panel>
        <Panel title="Execution guardrails" detail="Applied before provider dispatch">
          <div className="policy-row"><span>Request timeout</span><strong>20 seconds</strong></div>
          <div className="policy-row"><span>Safe retries</span><strong>Up to 3 attempts</strong></div>
          <div className="policy-row"><span>Unsafe mutations</span><strong>Single attempt</strong></div>
          <div className="policy-row"><span>Result handling</span><strong>Encrypted ledger</strong></div>
        </Panel>
      </div>
    </>
  );
}
