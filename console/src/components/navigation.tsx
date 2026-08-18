import {
  Activity,
  Blocks,
  Building2,
  Cable,
  ChartNoAxesCombined,
  ClipboardList,
  Gauge,
  Menu,
  Moon,
  Route,
  Sun,
  X,
} from "lucide-react";
import type { ConsoleActor, DataMode, Tenant, ViewId } from "../domain/console";

const items: Array<{ id: ViewId; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "tenants", label: "Tenants", icon: Building2 },
  { id: "connectors", label: "Connectors", icon: Cable },
  { id: "routing", label: "LLM routing", icon: Route },
  { id: "events", label: "Events", icon: Activity },
  { id: "usage", label: "Usage and cost", icon: ChartNoAxesCombined },
  { id: "audit", label: "Audit log", icon: ClipboardList },
];

export function Sidebar({ active, open, mode, actor, onSelect, onClose }: { active: ViewId; open: boolean; mode: DataMode; actor: ConsoleActor; onSelect: (view: ViewId) => void; onClose: () => void }) {
  return (
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="brand-row">
        <div className="brand-mark"><Blocks size={18} aria-hidden="true" /></div>
        <div>
          <strong>PAX</strong>
          <span>Console</span>
        </div>
        <button className="icon-button mobile-only" type="button" aria-label="Close navigation" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="environment-card">
        <span className="prototype-dot" />
        <div><strong>{mode === "live" ? "Production" : "Prototype"}</strong><small>{mode === "live" ? "Metadata only" : "No live backend"}</small></div>
      </div>
      <nav aria-label="Primary navigation" className="nav-list">
        <p>Workspace</p>
        {items.slice(0, 4).map((item) => <NavItem key={item.id} item={item} active={active} onSelect={onSelect} />)}
        <p>Monitoring</p>
        {items.slice(4).map((item) => <NavItem key={item.id} item={item} active={active} onSelect={onSelect} />)}
      </nav>
      <div className="operator-card">
        <div className="avatar">OP</div>
        <div><strong>{mode === "live" ? `${actor.kind} ${actor.role}` : "Operator session"}</strong><small>{mode === "live" ? "Owner-only site access" : "Identity adapter pending"}</small></div>
      </div>
    </aside>
  );
}

function NavItem({ item, active, onSelect }: { item: (typeof items)[number]; active: ViewId; onSelect: (view: ViewId) => void }) {
  const Icon = item.icon;
  return (
    <button type="button" className={active === item.id ? "nav-item active" : "nav-item"} aria-current={active === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
      <Icon size={17} aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  );
}

export function Topbar({ theme, mode, tenants, tenantId, onTenantChange, onThemeChange, onMenu }: { theme: "dark" | "light"; mode: DataMode; tenants: Tenant[]; tenantId: string; onTenantChange: (tenantId: string) => void; onThemeChange: () => void; onMenu: () => void }) {
  return (
    <header className="topbar">
      <button className="icon-button menu-button" type="button" aria-label="Open navigation" onClick={onMenu}><Menu size={18} /></button>
      <div className="context-switcher">
        <span>Admin</span>
        <label><b>Tenant context</b><select aria-label="Tenant context" value={tenantId} onChange={(event) => onTenantChange(event.target.value)}><option value="">All tenants</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
      </div>
      <div className="topbar-actions">
        <span className="prototype-badge">{mode === "live" ? "Live metadata" : "Prototype data"}</span>
        <button className="icon-button" type="button" aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={onThemeChange}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
}
