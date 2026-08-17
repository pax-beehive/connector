import type { EventRecord } from "../domain/console";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

export function EventsView({ events }: { events: EventRecord[] }) {
  return (
    <>
      <PageHeader eyebrow="Delivery ledger" title="Event delivery" detail="Sample webhook intake, delivery attempts, and replay controls." action={<button className="button secondary" type="button" disabled>Backfill API pending</button>} />
      <Panel title="Recent events" detail="Metadata only · payload bodies stay encrypted">
        <div className="table-wrap"><table><thead><tr><th>Event</th><th>Topic</th><th>Tenant</th><th>Status</th><th>Attempts</th><th>Received</th></tr></thead><tbody>
          {events.map((event) => <tr key={event.id}><td><code>{event.id}</code></td><td>{event.topic}</td><td>{event.tenant}</td><td><HealthPill health={event.status} /></td><td>{event.attempts}</td><td>{event.receivedAt}</td></tr>)}
        </tbody></table></div>
      </Panel>
    </>
  );
}
