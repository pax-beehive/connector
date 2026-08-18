import type { AuditEntry, DataMode } from "../domain/console";
import { PageHeader, Panel } from "../components/primitives";

export function AuditView({ mode, entries }: { mode: DataMode; entries: AuditEntry[] }) {
  const live = mode === "live";
  return (
    <>
      <PageHeader eyebrow={live ? "Production governance" : "Governance prototype"} title="Audit log" detail={live ? "Metadata-only audit records returned by the production admin boundary." : "Illustrative operator and service activity across tenant boundaries."} action={<button className="button secondary" type="button" disabled>Export API pending</button>} />
      <Panel title={live ? "Recorded activity" : "Sample activity"} detail={live ? "Current read-only snapshot" : "Planned retention · 365 days"}>
        <div className="audit-list">{entries.map((entry) => <article key={entry.id} className="audit-row"><div className="audit-mark" /><div><strong>{entry.action}</strong><span>{entry.target}</span></div><div><strong>{entry.actor}</strong><span>{entry.source}</span></div><time>{entry.time}</time></article>)}</div>
        {entries.length === 0 ? <p className="empty-state">No audit metadata is available in this tenant context.</p> : null}
      </Panel>
    </>
  );
}
