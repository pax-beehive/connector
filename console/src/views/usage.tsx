import type { UsageMeter } from "../domain/console";
import { PageHeader, Panel, ToneDot } from "../components/primitives";

export function UsageView({ usage }: { usage: UsageMeter[] }) {
  return (
    <>
      <PageHeader eyebrow="FinOps prototype" title="Usage and cost" detail="Illustrative tenant consumption, provider spend, budget posture, and reconciliation." />
      <section className="usage-grid">{usage.map((meter) => <article className="usage-card" key={meter.label}><div className="metric-label"><ToneDot tone={meter.tone} />{meter.label}</div><strong>{meter.value}</strong><span>{meter.detail}</span><div className="meter-track"><span style={{ width: `${meter.progress}%` }} /></div><small>{meter.progress}% consumed</small></article>)}</section>
      <div className="content-grid">
        <Panel title="Cost controls" detail="Sample policy"><div className="policy-row"><span>Budget alerts</span><strong>80% and 95%</strong></div><div className="policy-row"><span>Hard throttle</span><strong>Disabled</strong></div><div className="policy-row"><span>Unexplained cost</span><strong>$0.00 sample</strong></div></Panel>
        <Panel title="Reconciliation" detail="Sample export"><div className="policy-row"><span>Action ledger</span><strong>96,412 sample calls</strong></div><div className="policy-row"><span>Provider reports</span><strong>96,412 sample calls</strong></div><div className="policy-row"><span>Variance</span><strong>0.00% sample</strong></div></Panel>
      </div>
    </>
  );
}
