import { Plus } from "lucide-react";
import type { Connection, DataMode } from "../domain/console";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

export function ConnectorsView({ mode, connections, canConnect, onConnect }: { mode: DataMode; connections: Connection[]; canConnect: boolean; onConnect: () => void }) {
  const live = mode === "live";
  return (
    <>
      <PageHeader eyebrow="Credential vault" title="Connector fleet" detail={live ? "Production connection metadata. Credential material is never returned to the console." : "Sample provider connections, credential posture, and event activity."} action={<button className={canConnect ? "button primary" : "button secondary"} type="button" disabled={!canConnect} onClick={onConnect}><Plus size={16} />{canConnect ? "Connect provider" : live ? "Connection API pending" : "Select tenant to connect"}</button>} />
      <section className="connector-grid">
        {connections.map((connection) => (
          <article className="connector-card" key={connection.id}>
            <div className="connector-card-top"><div className="provider-glyph large">{connection.provider.slice(0, 1)}</div><HealthPill health={connection.status} /></div>
            <h2>{connection.provider}</h2><p>{connection.account}</p>
            <div className="connector-meta"><span>Tenant<strong>{connection.tenant}</strong></span><span>Last activity<strong>{connection.lastActivity}</strong></span><span>Actions<strong>{connection.actionCount}</strong></span></div>
            <button className="text-button" type="button" disabled>Connection API pending</button>
          </article>
        ))}
        {connections.length === 0 ? <p className="empty-state">No connection metadata is available in this tenant context.</p> : null}
      </section>
      <Panel title="Credential policy" detail={live ? "Enforced FDE credential-vault contract" : "Planned FDE credential-vault contract"} className="policy-panel">
        <div className="policy-row"><span>Envelope encryption</span><strong>Tenant-isolated KMS keys</strong></div>
        <div className="policy-row"><span>Rotation posture</span><strong>Failure-safe and audited</strong></div>
        <div className="policy-row"><span>Secret display</span><strong>Never returned to the console</strong></div>
      </Panel>
    </>
  );
}
