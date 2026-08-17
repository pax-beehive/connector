import type { AuditEntry } from "../domain/console";
import { PageHeader, Panel } from "../components/primitives";

export function AuditView({ entries }: { entries: AuditEntry[] }) {
  return (
    <>
      <PageHeader eyebrow="Governance prototype" title="Audit log" detail="Illustrative operator and service activity across tenant boundaries." action={<button className="button secondary" type="button" disabled>Export API pending</button>} />
      <Panel title="Sample activity" detail="Planned retention · 365 days">
        <div className="audit-list">{entries.map((entry) => <article key={entry.id} className="audit-row"><div className="audit-mark" /><div><strong>{entry.action}</strong><span>{entry.target}</span></div><div><strong>{entry.actor}</strong><span>{entry.source}</span></div><time>{entry.time}</time></article>)}</div>
      </Panel>
    </>
  );
}
