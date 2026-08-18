import type { DataMode, UsageMeter } from "../domain/console";
import { PageHeader, Panel, ToneDot } from "../components/primitives";

export function UsageView({ mode, usage }: { mode: DataMode; usage: UsageMeter[] }) {
  const live = mode === "live";
  return (
    <>
      <PageHeader eyebrow={live ? "Production usage" : "FinOps prototype"} title="Usage and cost" detail={live ? "Recorded usage aggregates from the production action ledger." : "Illustrative tenant consumption, provider spend, budget posture, and reconciliation."} />
      <section className="usage-grid">{usage.map((meter) => <article className="usage-card" key={`${meter.tenantId}:${meter.label}`}><div className="metric-label"><ToneDot tone={meter.tone} />{meter.label}</div><strong>{meter.value}</strong><span>{meter.detail}</span>{meter.progress === undefined ? null : <><div className="meter-track"><span style={{ width: `${meter.progress}%` }} /></div><small>{meter.progress}% consumed</small></>}</article>)}</section>
      {usage.length === 0 ? <p className="empty-state">No recorded usage is available in this tenant context.</p> : null}
      {live ? <Panel title="Cost boundary" detail="Read-only metadata"><div className="policy-row"><span>Source</span><strong>Action ledger aggregates</strong></div><div className="policy-row"><span>Mutation controls</span><strong>Not available in this console</strong></div></Panel> : <div className="content-grid"><Panel title="Cost controls" detail="Sample policy"><div className="policy-row"><span>Budget alerts</span><strong>80% and 95%</strong></div><div className="policy-row"><span>Hard throttle</span><strong>Disabled</strong></div><div className="policy-row"><span>Unexplained cost</span><strong>$0.00 sample</strong></div></Panel><Panel title="Reconciliation" detail="Sample export"><div className="policy-row"><span>Action ledger</span><strong>96,412 sample calls</strong></div><div className="policy-row"><span>Provider reports</span><strong>96,412 sample calls</strong></div><div className="policy-row"><span>Variance</span><strong>0.00% sample</strong></div></Panel></div>}
    </>
  );
}
