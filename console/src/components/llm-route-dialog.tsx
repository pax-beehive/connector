import { ArrowDown, ArrowUp, Check, Route, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { DataMode, LlmModel, Tenant } from "../domain/console";

interface LlmRouteDialogProps {
  mode: DataMode;
  tenants: Tenant[];
  models: LlmModel[];
  onClose: () => void;
}

interface SavedRoute {
  id: string;
  task_class: string;
  targets: string[];
  version: number;
}

const taskClasses = ["default", "chat", "extract", "classify"] as const;

export function LlmRouteDialog(props: LlmRouteDialogProps) {
  return props.mode === "live"
    ? <LiveLlmRouteDialog {...props} />
    : <PrototypeLlmRouteDialog onClose={props.onClose} />;
}

function LiveLlmRouteDialog({ onClose, tenants, models }: LlmRouteDialogProps) {
  const [taskClass, setTaskClass] = useState<string>(taskClasses[0]);
  const [tenantId, setTenantId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [candidate, setCandidate] = useState(models[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState("");
  const [route, setRoute] = useState<SavedRoute | null>(null);

  function addTarget() {
    if (candidate && !targets.includes(candidate)) setTargets([...targets, candidate]);
  }

  function moveTarget(index: number, offset: number) {
    const next = [...targets];
    const [moved] = next.splice(index, 1);
    next.splice(index + offset, 0, moved);
    setTargets(next);
  }

  function removeTarget(index: number) {
    setTargets(targets.filter((_, position) => position !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKind("");
    try {
      const saved = await saveRoute(JSON.stringify({
        task_class: taskClass,
        targets,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      }));
      setRoute(saved);
    } catch (error) {
      setErrorKind(error instanceof AdminRequestError ? error.kind : "admin_unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  function finish() {
    onClose();
    window.location.reload();
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="llm-route-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">LLM gateway</p><h2 id="llm-route-title">Set route</h2></div>
          <button className="icon-button" type="button" aria-label="Close set route dialog" onClick={onClose}><X size={18} /></button>
        </div>
        {route ? <RouteOutcome route={route} /> : (
          <form onSubmit={submit}>
            <div className="credential-form">
              <p>Routes resolve in target order with failover before the first response byte. A tenant-scoped route overrides the global route for its task class.</p>
              <label>Task class<select value={taskClass} onChange={(event) => setTaskClass(event.target.value)}>{taskClasses.map((candidateClass) => <option key={candidateClass} value={candidateClass}>{candidateClass}</option>)}</select></label>
              <label>Tenant<select value={tenantId} onChange={(event) => setTenantId(event.target.value)}><option value="">Global default</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
              <label>Model<select value={candidate} onChange={(event) => setCandidate(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
              <div>
                <button className="button secondary" type="button" disabled={!candidate || targets.includes(candidate)} onClick={addTarget}>Add target</button>
              </div>
              {targets.map((target, index) => (
                <div className="target-row" key={target}>
                  <strong>{index + 1}. {target}</strong>
                  <span className="target-controls">
                    <button className="icon-button" type="button" aria-label={`Move ${target} up`} disabled={index === 0} onClick={() => moveTarget(index, -1)}><ArrowUp size={14} /></button>
                    <button className="icon-button" type="button" aria-label={`Move ${target} down`} disabled={index === targets.length - 1} onClick={() => moveTarget(index, 1)}><ArrowDown size={14} /></button>
                    <button className="icon-button" type="button" aria-label={`Remove ${target}`} onClick={() => removeTarget(index)}><X size={14} /></button>
                  </span>
                </div>
              ))}
              {errorKind ? <p className="form-error" role="alert">Route update failed: {friendlyError(errorKind)}</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="button secondary" type="button" disabled={submitting} onClick={onClose}>Cancel</button>
              <button className="button primary" type="submit" disabled={submitting || targets.length === 0}>{submitting ? "Saving..." : "Save route"}</button>
            </div>
          </form>
        )}
        {route ? <div className="dialog-actions"><button className="button primary" type="button" onClick={finish}>Done</button></div> : null}
      </section>
    </div>
  );
}

function RouteOutcome({ route }: { route: SavedRoute }) {
  return (
    <div className="credential-step" aria-live="polite">
      <div className="credential-icon"><Check size={22} /></div>
      <h3>Route saved</h3>
      <p>The route is live. Targets are tried in the order shown.</p>
      <div className="info-row"><span>Task class</span><strong>{route.task_class}</strong></div>
      <div className="info-row"><span>Targets</span><strong>{route.targets.join(" → ")}</strong></div>
      <div className="info-row"><span>Version</span><strong>{route.version}</strong></div>
    </div>
  );
}

async function saveRoute(payload: string): Promise<SavedRoute> {
  const response = await fetch("/api/admin/llm/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  const body = await response.json() as unknown;
  if (!response.ok) throw new AdminRequestError(errorKind(body));
  if (!isRecord(body) || !isRoute(body.route)) throw new AdminRequestError("invalid_response");
  return body.route;
}

class AdminRequestError extends Error {
  constructor(readonly kind: string) {
    super("admin request failed");
  }
}

function errorKind(value: unknown) {
  return isRecord(value) && isRecord(value.error) && typeof value.error.kind === "string"
    ? value.error.kind
    : "admin_unavailable";
}

function isRoute(value: unknown): value is SavedRoute {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.task_class === "string"
    && Array.isArray(value.targets)
    && value.targets.every((target) => typeof target === "string")
    && typeof value.version === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function friendlyError(kind: string) {
  const messages: Record<string, string> = {
    access_invalid: "your Console session could not be verified",
    actor_forbidden: "operator access is required to set routes",
    invalid_request: "the route configuration is invalid",
    admin_unavailable: "the routing service is temporarily unavailable",
  };
  return messages[kind] ?? "the request could not be completed";
}

function PrototypeLlmRouteDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="llm-route-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">LLM gateway</p><h2 id="llm-route-title">Set route</h2></div>
          <button className="icon-button" type="button" aria-label="Close set route dialog" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="credential-step">
          <div className="credential-icon"><Route size={22} /></div>
          <h3>Prototype route configuration</h3>
          <p>Route configuration runs through the platform admin API in live mode. This framework does not modify prototype data.</p>
          <div className="info-row"><span>Environment</span><strong>Prototype only</strong></div>
        </div>
        <div className="dialog-actions">
          <button className="button primary" type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
