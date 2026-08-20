import { Brain, Check, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { DataMode } from "../domain/console";

interface LlmModelDialogProps {
  mode: DataMode;
  onClose: () => void;
}

interface EnrolledModel {
  id: string;
  provider: string;
  endpoint: string;
  status: string;
}

const providers = ["openai", "anthropic", "deepseek", "openrouter"] as const;
type Provider = (typeof providers)[number];

const endpointPrefill: Record<Provider, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api",
};

export function LlmModelDialog(props: LlmModelDialogProps) {
  return props.mode === "live"
    ? <LiveLlmModelDialog {...props} />
    : <PrototypeLlmModelDialog onClose={props.onClose} />;
}

function LiveLlmModelDialog({ onClose }: LlmModelDialogProps) {
  const [provider, setProvider] = useState<Provider>("openai");
  const [modelName, setModelName] = useState("");
  const [endpoint, setEndpoint] = useState(endpointPrefill.openai);
  const [apiKey, setApiKey] = useState("");
  const [inPrice, setInPrice] = useState("");
  const [outPrice, setOutPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState("");
  const [model, setModel] = useState<EnrolledModel | null>(null);

  function selectProvider(next: Provider) {
    setProvider(next);
    setEndpoint(endpointPrefill[next]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKind("");
    try {
      const enrolled = await enrollModel(JSON.stringify({
        id: `${provider}/${modelName.trim()}`,
        provider,
        endpoint: endpoint.trim(),
        api_key: apiKey,
        in_cost_micros_per_mtok: Number(inPrice),
        out_cost_micros_per_mtok: Number(outPrice),
      }));
      setModel(enrolled);
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
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="llm-model-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">LLM gateway</p><h2 id="llm-model-title">Add model</h2></div>
          <button className="icon-button" type="button" aria-label="Close add model dialog" onClick={onClose}><X size={18} /></button>
        </div>
        {model ? <ModelOutcome model={model} /> : (
          <form onSubmit={submit}>
            <div className="credential-form">
              <p>The model is enrolled with the platform admin API. The API key is encrypted at rest and never displayed again.</p>
              <label>Provider<select value={provider} onChange={(event) => selectProvider(event.target.value as Provider)}>{providers.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label>
              <label>Model name<input required maxLength={120} pattern="[A-Za-z0-9._-]+" title="Letters, digits, dots, underscores, and hyphens" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="gpt-5" /></label>
              <label>Endpoint<input required type="url" maxLength={200} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
              <label>API key<input required type="password" autoComplete="off" maxLength={512} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
              <label>Input price (micros per MTok)<input required type="number" min="0" step="1" value={inPrice} onChange={(event) => setInPrice(event.target.value)} placeholder="1250000" /></label>
              <label>Output price (micros per MTok)<input required type="number" min="0" step="1" value={outPrice} onChange={(event) => setOutPrice(event.target.value)} placeholder="10000000" /></label>
              {errorKind ? <p className="form-error" role="alert">Model enrollment failed: {friendlyError(errorKind)}</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="button secondary" type="button" disabled={submitting} onClick={onClose}>Cancel</button>
              <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Enrolling..." : "Enroll model"}</button>
            </div>
          </form>
        )}
        {model ? <div className="dialog-actions"><button className="button primary" type="button" onClick={finish}>Done</button></div> : null}
      </section>
    </div>
  );
}

function ModelOutcome({ model }: { model: EnrolledModel }) {
  return (
    <div className="credential-step" aria-live="polite">
      <div className="credential-icon"><Check size={22} /></div>
      <h3>Model enrolled</h3>
      <p>The model is registered. Its API key is stored encrypted and is never displayed.</p>
      <div className="info-row"><span>Model</span><strong>{model.id}</strong></div>
      <div className="info-row"><span>Endpoint</span><strong>{model.endpoint}</strong></div>
      <div className="info-row"><span>Status</span><strong>{model.status}</strong></div>
    </div>
  );
}

async function enrollModel(payload: string): Promise<EnrolledModel> {
  const response = await fetch("/api/admin/llm/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  const body = await response.json() as unknown;
  if (!response.ok) throw new AdminRequestError(errorKind(body));
  if (!isRecord(body) || !isModel(body.model)) throw new AdminRequestError("invalid_response");
  return body.model;
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

function isModel(value: unknown): value is EnrolledModel {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.provider === "string"
    && typeof value.endpoint === "string"
    && typeof value.status === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function friendlyError(kind: string) {
  const messages: Record<string, string> = {
    access_invalid: "your Console session could not be verified",
    actor_forbidden: "operator access is required to enroll models",
    invalid_request: "the model details are invalid",
    llm_model_conflict: "that model id is already enrolled",
    admin_unavailable: "the model service is temporarily unavailable",
    access_unavailable: "access verification is temporarily unavailable",
    database_unavailable: "the admin database is temporarily unavailable",
    operator_configuration_unavailable: "the Console proxy is not fully configured",
    origin_unavailable: "the admin service could not be reached",
    origin_redirect_rejected: "the admin service rejected the proxied request",
  };
  return messages[kind] ?? "the request could not be completed";
}

function PrototypeLlmModelDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="llm-model-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">LLM gateway</p><h2 id="llm-model-title">Add model</h2></div>
          <button className="icon-button" type="button" aria-label="Close add model dialog" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="credential-step">
          <div className="credential-icon"><Brain size={22} /></div>
          <h3>Prototype model enrollment</h3>
          <p>Model enrollment runs through the platform admin API in live mode. This framework does not modify prototype data.</p>
          <div className="info-row"><span>Environment</span><strong>Prototype only</strong></div>
        </div>
        <div className="dialog-actions">
          <button className="button primary" type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
