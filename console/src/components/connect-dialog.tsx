import { Check, KeyRound, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { DataMode } from "../domain/console";

const prototypeProviders = ["Instagram", "OpenAI", "Anthropic"];

interface ConnectDialogProps {
  mode: DataMode;
  tenantId: string;
  tenantName: string;
  onClose: () => void;
}

interface ConnectionResult {
  id: string;
}

interface CheckResult {
  status: "succeeded" | "failed";
  latency_ms: number;
  provider_code?: string;
}

export function ConnectDialog(props: ConnectDialogProps) {
  return props.mode === "live"
    ? <LiveInstagramDialog {...props} />
    : <PrototypeConnectDialog tenantName={props.tenantName} onClose={props.onClose} />;
}

function LiveInstagramDialog({ tenantId, tenantName, onClose }: ConnectDialogProps) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKind("");
    setCheck(null);
    const payload = JSON.stringify({
      tenant_id: tenantId,
      name,
      external_account_id: accountId,
      is_default: isDefault,
      credential: { access_token: accessToken, app_secret: appSecret },
    });
    setAccessToken("");
    setAppSecret("");
    try {
      const connection = await createInstagramConnection(payload);
      const result = await checkInstagramConnection(tenantId, connection.id);
      setCheck(result);
    } catch (error) {
      setErrorKind(error instanceof OperatorRequestError ? error.kind : "operator_unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">Credential vault</p><h2 id="connect-title">Connect Instagram</h2></div>
          <button className="icon-button" type="button" aria-label="Close connection dialog" onClick={onClose}><X size={18} /></button>
        </div>
        {check ? <ConnectionOutcome check={check} tenantName={tenantName} /> : (
          <form onSubmit={submit}>
            <div className="credential-form">
              <p>Credentials are sent once to the encrypted tenant vault. They are never returned to this browser.</p>
              <label>Connection name<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="Production Instagram" /></label>
              <label>Instagram account ID<input required maxLength={512} value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="1784..." /></label>
              <label>Access token<input required type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} /></label>
              <label>App secret<input required type="password" autoComplete="new-password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} /></label>
              <label className="checkbox-field"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />Use as the default Instagram connection</label>
              <div className="info-row"><span>Tenant</span><strong>{tenantName}</strong></div>
              {errorKind ? <p className="form-error" role="alert">Connection failed: {friendlyError(errorKind)}</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="button secondary" type="button" disabled={submitting} onClick={onClose}>Cancel</button>
              <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Testing..." : "Save and test"}</button>
            </div>
          </form>
        )}
        {check ? <div className="dialog-actions"><button className="button primary" type="button" onClick={onClose}>Done</button></div> : null}
      </section>
    </div>
  );
}

function ConnectionOutcome({ check, tenantName }: { check: CheckResult; tenantName: string }) {
  const succeeded = check.status === "succeeded";
  return (
    <div className="credential-step" aria-live="polite">
      <div className="credential-icon"><Check size={22} /></div>
      <h3>{succeeded ? "Connection succeeded" : "Connection failed"}</h3>
      <p>{succeeded ? "Instagram accepted the read-only media check." : "The credential was stored, but Instagram rejected or could not complete the check."}</p>
      <div className="info-row"><span>Tenant</span><strong>{tenantName}</strong></div>
      <div className="info-row"><span>Latency</span><strong>{check.latency_ms} ms</strong></div>
      {check.provider_code ? <div className="info-row"><span>Provider code</span><strong>{check.provider_code}</strong></div> : null}
    </div>
  );
}

async function createInstagramConnection(payload: string): Promise<ConnectionResult> {
  const response = await fetch("/api/operator/connections/instagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  const body = await response.json() as unknown;
  if (!response.ok) throw new OperatorRequestError(errorKind(body));
  if (!isRecord(body) || !isRecord(body.connection) || typeof body.connection.id !== "string") {
    throw new OperatorRequestError("invalid_response");
  }
  return { id: body.connection.id };
}

async function checkInstagramConnection(tenantId: string, connectionId: string): Promise<CheckResult> {
  const response = await fetch(`/api/operator/connections/${connectionId}/checks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  const body = await response.json() as unknown;
  if (!response.ok) throw new OperatorRequestError(errorKind(body));
  if (!isRecord(body) || !isCheck(body.check)) throw new OperatorRequestError("invalid_response");
  return body.check;
}

class OperatorRequestError extends Error {
  constructor(readonly kind: string) {
    super("operator request failed");
  }
}

function errorKind(value: unknown) {
  return isRecord(value) && isRecord(value.error) && typeof value.error.kind === "string"
    ? value.error.kind
    : "operator_unavailable";
}

function isCheck(value: unknown): value is CheckResult {
  return isRecord(value)
    && (value.status === "succeeded" || value.status === "failed")
    && typeof value.latency_ms === "number"
    && (value.provider_code === undefined || typeof value.provider_code === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function friendlyError(kind: string) {
  const messages: Record<string, string> = {
    access_invalid: "your Console session could not be verified",
    actor_forbidden: "operator access is required for this tenant",
    invalid_request: "the connection details are invalid",
    operator_unavailable: "the connection service is temporarily unavailable",
    access_unavailable: "access verification is temporarily unavailable",
    database_unavailable: "the platform database is temporarily unavailable",
    operator_configuration_unavailable: "the Console proxy is not fully configured",
    origin_unavailable: "the platform edge could not be reached",
    origin_redirect_rejected: "the platform edge rejected the proxied request",
  };
  return messages[kind] ?? "the request could not be completed";
}

function PrototypeConnectDialog({ tenantName, onClose }: { tenantName: string; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [provider, setProvider] = useState<string | null>(null);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">Step {step} of 2</p><h2 id="connect-title">Connect provider</h2></div>
          <button className="icon-button" type="button" aria-label="Close connection dialog" onClick={onClose}><X size={18} /></button>
        </div>
        {step === 1 ? (
          <div className="provider-options">
            <p>Select the provider this tenant will authorize.</p>
            {prototypeProviders.map((providerName) => (
              <button className={provider === providerName ? "provider-option selected" : "provider-option"} type="button" key={providerName} onClick={() => setProvider(providerName)}>
                <span className="provider-glyph">{providerName.slice(0, 1)}</span><span><strong>{providerName}</strong><small>Managed credential vault</small></span>{provider === providerName ? <Check size={17} /> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="credential-step">
            <div className="credential-icon"><KeyRound size={22} /></div>
            <h3>Authorize {provider}</h3>
            <p>The future API flow will exchange provider credentials through the vault API. This framework does not collect secrets.</p>
            <div className="info-row"><span>Tenant</span><strong>{tenantName}</strong></div>
            <div className="info-row"><span>Environment</span><strong>Prototype only</strong></div>
          </div>
        )}
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? "Cancel" : "Back"}</button>
          {step === 1 ? <button className="button primary" type="button" disabled={!provider} onClick={() => provider && setStep(2)}>Continue</button> : <button className="button primary" type="button" disabled>Awaiting API</button>}
        </div>
      </section>
    </div>
  );
}
