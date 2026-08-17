import type { ConsoleSnapshot } from "../domain/console";
import { HealthPill, PageHeader, Panel, ToneDot } from "../components/primitives";

export function OverviewView({ snapshot }: { snapshot: ConsoleSnapshot }) {
  return (
    <>
      <PageHeader eyebrow="Platform prototype" title="Operational overview" detail="Illustrative operating posture across sample tenants and provider boundaries." />
      <section className="metric-grid" aria-label="Platform metrics">
        {snapshot.metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className="metric-label"><ToneDot tone={metric.tone} />{metric.label}</div>
            <strong>{metric.value}</strong><span>{metric.detail}</span>
          </article>
        ))}
      </section>
      <div className="content-grid two-thirds">
        <Panel title="Attention queue" detail="Items that need an operator decision">
          <div className="attention-list">
            {snapshot.attention.map((item) => (
              <article key={item.id} className="attention-item"><ToneDot tone={item.tone} /><div><strong>{item.title}</strong><span>{item.detail}</span></div><time>{item.time}</time></article>
            ))}
          </div>
        </Panel>
        <Panel title="Provider health" detail="Sample 24-hour window">
          <div className="provider-health-list">
            {snapshot.providers.map((provider) => (
              <div className="provider-health" key={provider.name}><div><strong>{provider.name}</strong><span>{provider.latency} p95</span></div><div><HealthPill health={provider.status} /><small>{provider.uptime}</small></div></div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
