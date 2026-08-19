import { Building2, Check, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { DataMode } from "../domain/console";

interface CreateTenantDialogProps {
  mode: DataMode;
  onClose: () => void;
}

interface CreatedTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
}

export function CreateTenantDialog(props: CreateTenantDialogProps) {
  return props.mode === "live"
    ? <LiveCreateTenantDialog {...props} />
    : <PrototypeCreateTenantDialog onClose={props.onClose} />;
}

function LiveCreateTenantDialog({ onClose }: CreateTenantDialogProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState("");
  const [tenant, setTenant] = useState<CreatedTenant | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKind("");
    try {
      const created = await createTenant(JSON.stringify({ slug, name }));
      setTenant(created);
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
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-tenant-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">Tenant administration</p><h2 id="create-tenant-title">Add tenant</h2></div>
          <button className="icon-button" type="button" aria-label="Close create tenant dialog" onClick={onClose}><X size={18} /></button>
        </div>
        {tenant ? <TenantOutcome tenant={tenant} /> : (
          <form onSubmit={submit}>
            <div className="credential-form">
              <p>The tenant is registered with the platform admin API. API keys are provisioned separately.</p>
              <label>Tenant name<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="Northstar Retail" /></label>
              <label>Slug<input required maxLength={63} pattern="[a-z0-9-]+" title="Lowercase letters, digits, and hyphens" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="northstar-retail" /></label>
              {errorKind ? <p className="form-error" role="alert">Tenant creation failed: {friendlyError(errorKind)}</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="button secondary" type="button" disabled={submitting} onClick={onClose}>Cancel</button>
              <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create tenant"}</button>
            </div>
          </form>
        )}
        {tenant ? <div className="dialog-actions"><button className="button primary" type="button" onClick={finish}>Done</button></div> : null}
      </section>
    </div>
  );
}

function TenantOutcome({ tenant }: { tenant: CreatedTenant }) {
  return (
    <div className="credential-step" aria-live="polite">
      <div className="credential-icon"><Check size={22} /></div>
      <h3>Tenant created</h3>
      <p>The tenant is registered. API keys are provisioned separately.</p>
      <div className="info-row"><span>Name</span><strong>{tenant.name}</strong></div>
      <div className="info-row"><span>Slug</span><strong>{tenant.slug}</strong></div>
      <div className="info-row"><span>Status</span><strong>{tenant.status}</strong></div>
    </div>
  );
}

async function createTenant(payload: string): Promise<CreatedTenant> {
  const response = await fetch("/api/admin/tenants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  const body = await response.json() as unknown;
  if (!response.ok) throw new AdminRequestError(errorKind(body));
  if (!isRecord(body) || !isTenant(body.tenant)) throw new AdminRequestError("invalid_response");
  return body.tenant;
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

function isTenant(value: unknown): value is CreatedTenant {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.slug === "string"
    && typeof value.name === "string"
    && typeof value.status === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function friendlyError(kind: string) {
  const messages: Record<string, string> = {
    access_invalid: "your Console session could not be verified",
    actor_forbidden: "operator access is required to create tenants",
    invalid_request: "the tenant details are invalid",
    tenant_conflict: "that slug is already taken",
    admin_unavailable: "the tenant service is temporarily unavailable",
  };
  return messages[kind] ?? "the request could not be completed";
}

function PrototypeCreateTenantDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-tenant-title">
        <div className="dialog-heading">
          <div><p className="eyebrow">Tenant administration</p><h2 id="create-tenant-title">Add tenant</h2></div>
          <button className="icon-button" type="button" aria-label="Close create tenant dialog" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="credential-step">
          <div className="credential-icon"><Building2 size={22} /></div>
          <h3>Prototype tenant creation</h3>
          <p>Tenant provisioning runs through the platform admin API in live mode. This framework does not modify prototype data.</p>
          <div className="info-row"><span>Environment</span><strong>Prototype only</strong></div>
        </div>
        <div className="dialog-actions">
          <button className="button primary" type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
