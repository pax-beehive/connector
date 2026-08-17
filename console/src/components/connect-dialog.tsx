import { Check, KeyRound, X } from "lucide-react";
import { useState } from "react";

const providers = ["Instagram", "OpenAI", "Anthropic"];

export function ConnectDialog({ tenantName, onClose }: { tenantName: string; onClose: () => void }) {
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
            {providers.map((name) => (
              <button className={provider === name ? "provider-option selected" : "provider-option"} type="button" key={name} onClick={() => setProvider(name)}>
                <span className="provider-glyph">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>Managed credential vault</small></span>{provider === name ? <Check size={17} /> : null}
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
