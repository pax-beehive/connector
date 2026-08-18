import { Search } from "lucide-react";
import { useState } from "react";
import type { DataMode, Tenant } from "../domain/console";
import { HealthPill, PageHeader, Panel } from "../components/primitives";

export function TenantsView({ mode, tenants }: { mode: DataMode; tenants: Tenant[] }) {
  const [query, setQuery] = useState("");
  const filtered = tenants.filter((tenant) => `${tenant.name} ${tenant.slug}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageHeader eyebrow="Administration" title="Tenant operations" detail={mode === "live" ? "Read-only production tenant metadata." : "Prototype tenant administration and governance."} action={<button className="button secondary" type="button" disabled>Tenant API pending</button>} />
      <Panel title="Tenant directory" detail={`${filtered.length} of ${tenants.length} tenants`}>
        <label className="search-field"><Search size={16} /><span className="sr-only">Search tenants</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or slug" /></label>
        <div className="table-wrap">
          <table><thead><tr><th>Tenant</th><th>Status</th><th>Connections</th><th>Actions</th><th>Recorded cost</th></tr></thead>
            <tbody>{filtered.map((tenant) => <tr key={tenant.id}><td><strong>{tenant.name}</strong><small>{tenant.slug}</small></td><td><HealthPill health={tenant.status} /></td><td>{tenant.connections}</td><td>{tenant.actions}</td><td>{tenant.cost}</td></tr>)}</tbody>
          </table>
        </div>
        {filtered.length === 0 ? <p className="empty-state">No tenants match this search.</p> : null}
      </Panel>
    </>
  );
}
