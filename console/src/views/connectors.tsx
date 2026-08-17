import { Plus } from "lucide-react";
import type { Connection } from "../domain/console";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

export function ConnectorsView({ connections, canConnect, onConnect }: { connections: Connection[]; canConnect: boolean; onConnect: () => void }) {
  return (
    <>
      <PageHeader eyebrow="Credential vault" title="Connector fleet" detail="Sample provider connections, credential posture, and event activity." action={<button className={canConnect ? "button primary" : "button secondary"} type="button" disabled={!canConnect} onClick={onConnect}><Plus size={16} />{canConnect ? "Connect provider" : "Select tenant to connect"}</button>} />
      <section className="connector-grid">
        {connections.map((connection) => (
          <article className="connector-card" key={connection.id}>
            <div className="connector-card-top"><div className="provider-glyph large">{connection.provider.slice(0, 1)}</div><HealthPill health={connection.status} /></div>
            <h2>{connection.provider}</h2><p>{connection.account}</p>
            <div className="connector-meta"><span>Tenant<strong>{connection.tenant}</strong></span><span>Last activity<strong>{connection.lastSync}</strong></span><span>Events<strong>{connection.eventCount}</strong></span></div>
            <button className="text-button" type="button" disabled>Connection API pending</button>
          </article>
        ))}
      </section>
      <Panel title="Credential policy" detail="Planned FDE credential-vault contract" className="policy-panel">
        <div className="policy-row"><span>Envelope encryption</span><strong>Tenant-isolated KMS keys</strong></div>
        <div className="policy-row"><span>Rotation posture</span><strong>Failure-safe and audited</strong></div>
        <div className="policy-row"><span>Secret display</span><strong>Never returned to the console</strong></div>
      </Panel>
    </>
  );
}
