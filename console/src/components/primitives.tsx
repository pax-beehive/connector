import type { Health, Tone } from "../domain/console";

const healthLabels: Record<Health, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failed: "Failed",
};

export function HealthPill({ health }: { health: Health }) {
  return <span className={`status-pill status-${health}`}>{healthLabels[health]}</span>;
}

export function ToneDot({ tone }: { tone: Tone }) {
  return <span className={`tone-dot tone-${tone}`} aria-hidden="true" />;
}

export function PageHeader({ title, eyebrow, detail, action }: { title: string; eyebrow: string; detail: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-detail">{detail}</p>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function Panel({ title, detail, children, className = "" }: { title: string; detail?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {detail ? <p>{detail}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
